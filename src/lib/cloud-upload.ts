import { z } from "zod";
import { randomUUID,createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { db } from "./db";
import { assert, localDate, validDate } from "./domain";
import { isRh, audit } from "./compliance";
import { detectMime } from "./storage";
import { storageClient, storeObject, getObject, removeObjects } from "./object-store";
import type { Actor } from "./auth";
interface Slot { key:string;filename:string;mime:string;size:number }
export async function prepareUpload(actor:Actor,input:unknown) {
 const data=z.object({obligationId:z.string().optional(),purpose:z.enum(["DOCUMENT","IMPORT"]).default("DOCUMENT"),files:z.array(z.object({filename:z.string().min(1).max(180),mime:z.string().max(100),size:z.number().int().min(1).max(10*1024*1024)})).min(1).max(5)}).parse(input);
 if(data.purpose==="IMPORT") assert(false,"La importación está cerrada.",404);
 else {
   assert(data.obligationId,"Seleccione la obligación.");
   const o=await db.obligation.findUniqueOrThrow({where:{id:data.obligationId},include:{employee:true}});
   assert((isRh(actor)||o.employeeId===actor.id)&&o.employee.active&&o.status==="OPEN","No puede entregar en esta obligación.",403);
   assert(!await db.submission.count({where:{obligationId:o.id,status:"PENDING"}}),"Ya existe una entrega en revisión.",409);
   assert(data.files.every(f=>["application/pdf","image/png","image/jpeg"].includes(f.mime)),"Use PDF, JPG o PNG.");
 }
 const id=randomUUID();
 const slots:Slot[]=data.files.map(f=>({...f,filename:f.filename.replace(/^.*[\\/]/,""),key:`${id}/${randomUUID()}`}));
 const urls=[];
 for(const f of slots) {
   const {data:token,error}=await storageClient().storage.from("hhrr-uploads").createSignedUploadUrl(f.key,{upsert:false});
   assert(token&&!error,"No se pudo preparar la carga.",503);
   urls.push({...f,url:token.signedUrl});
 }
 await db.uploadSession.create({data:{id,actorId:actor.accountId,obligationId:data.obligationId,purpose:data.purpose,manifest:JSON.stringify(slots),expiresAt:new Date(Date.now()+2*3600000)}});
 return {id,files:urls};
}
export async function completeUpload(actor:Actor,input:unknown) {
 const data=z.object({uploadId:z.string(),issueDate:z.string().nullable().optional(),expiresDate:z.string().nullable().optional()}).parse(input);
 const upload=await db.uploadSession.findUniqueOrThrow({where:{id:data.uploadId}});
 assert(upload.actorId===actor.accountId&&upload.purpose==="DOCUMENT"&&upload.expiresAt>new Date(),"Carga inválida o vencida.",403);
 if(upload.status==="CONSUMED") {
  const entry=await db.audit.findFirst({where:{actorId:actor.accountId,action:"SUBMISSION_CREATED",detail:{contains:`"uploadId":"${upload.id}"`}}});
  assert(entry,"Esta carga ya se registró.",409);return db.submission.findUniqueOrThrow({where:{id:entry.entityId}});
 }
 const claimed=await db.uploadSession.updateMany({where:{id:upload.id,status:"PREPARED"},data:{status:"PROCESSING"}});
 assert(claimed.count===1,"La carga está siendo procesada.",409);
 const copied:string[]=[];
 try {
   if(data.issueDate) assert(validDate(data.issueDate)&&data.issueDate<=localDate(),"Fecha de emisión inválida.");
   if(data.expiresDate) assert(validDate(data.expiresDate),"Vencimiento inválido.");
   const files:{filename:string;storageKey:string;mime:string;size:number;sha256:string}[]=[];
   for(const f of JSON.parse(upload.manifest) as Slot[]) {
     const bytes=await getObject("hhrr-uploads",f.key);
     assert(bytes.length===f.size&&bytes.length<=10*1024*1024,"Tamaño de archivo inválido.");
     const mime=detectMime(bytes); assert(mime===f.mime,"El archivo no coincide con el formato declarado.");
     if(mime==="application/pdf") { try {const pdf=await PDFDocument.load(bytes);assert(pdf.getPageCount()>0,"PDF vacío.");} catch {throw new Error("El PDF está dañado o protegido por contraseña.");} }
     if(mime==="image/png"||mime==="image/jpeg") {try {await sharp(bytes,{limitInputPixels:50000000}).stats();} catch {throw new Error("La imagen está dañada o excede las dimensiones admitidas.");}}
     const key=`${randomUUID()}`;
     await storeObject("hhrr-documents",key,bytes,mime!); copied.push(key);
     files.push({filename:f.filename,storageKey:key,mime:mime!,size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
   }
   const submission=await db.$transaction(async tx=>{
     const o=await tx.obligation.findUniqueOrThrow({where:{id:upload.obligationId!},include:{employee:true}});
     assert(o.status==="OPEN"&&o.employee.active&&(isRh(actor)||o.employeeId===actor.id),"La obligación ya no admite esta entrega.",409);
     assert(!await tx.submission.count({where:{obligationId:o.id,status:"PENDING"}}),"Ya existe una entrega en revisión.",409);
     const result=await tx.submission.create({data:{employeeId:o.employeeId,obligationId:o.id,issueDate:data.issueDate,expiresDate:data.expiresDate,receivedDate:localDate(),files:{create:files}}});
     await tx.uploadSession.update({where:{id:upload.id},data:{status:"CONSUMED"}});
     await audit(tx,actor.accountId,"SUBMISSION_CREATED",result.id,{uploadId:upload.id,obligationId:o.id,files:files.map(f=>({name:f.filename,size:f.size}))});
     return result;
   },{timeout:15000});
   return submission;
 } catch(error) {
   await removeObjects("hhrr-documents",copied);
   await db.uploadSession.updateMany({where:{id:upload.id,status:"PROCESSING"},data:{status:"PREPARED"}});
   throw error;
 }
}
export async function consumeImportUpload(actor:Actor,id:string) {
 const u=await db.uploadSession.findUniqueOrThrow({where:{id}});
 assert(isRh(actor)&&u.actorId===actor.accountId&&u.purpose==="IMPORT"&&u.expiresAt>new Date(),"Carga inválida.",403);
 const claimed=await db.uploadSession.updateMany({where:{id,status:"PREPARED"},data:{status:"CONSUMED"}});
 assert(claimed.count===1,"Carga utilizada.",409);
 const slot=(JSON.parse(u.manifest) as Slot[])[0];
 const bytes=await getObject("hhrr-uploads",slot.key);
 assert(bytes.length===slot.size&&bytes.subarray(0,2).toString()==="PK","Use un archivo Excel XLSX válido.");
 return new File([new Uint8Array(bytes)],slot.filename,{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
export async function cleanUploads(now=new Date()) {
 const rows=await db.uploadSession.findMany({where:{expiresAt:{lt:now},status:{not:"EXPIRED"}},take:25});
 for(const row of rows) {await removeObjects("hhrr-uploads",(JSON.parse(row.manifest) as Slot[]).map(f=>f.key));await db.uploadSession.update({where:{id:row.id},data:{status:"EXPIRED"}});}
}
