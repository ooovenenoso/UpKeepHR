import { db } from "./db";
import { isRh } from "./compliance";
import { assert,localDate,displayDate } from "./domain";
import { currentRequirements,dashboardData } from "./dashboard";
import { reportRows } from "./reports";
import { brandedBytes } from "./branded-export";
import type { Employee } from "../generated/prisma/client";
import {cloudStorage} from "./config";
import {randomUUID} from "node:crypto";
import {storeObject,signedDownload} from "./object-store";
export const reportKinds={executive:"Resumen ejecutivo",compliance:"Cumplimiento vigente",expiry:"Vencimientos",review:"Cola y carga de RH",law:"Ciclos Ley 300",history:"Historial de entregas",audit:"Auditoría",engine:"Notificaciones y motor"};
const statusNames:Record<string,string>={PENDING:"En revisión",APPROVED:"Aprobada",REJECTED:"Rechazada",DISABLED:"Correo deshabilitado",PREVIEW:"Vista previa",ACCEPTED:"Aceptado",DELIVERED:"Entregado",FAILED:"Falló",UNCERTAIN:"Por comprobar"};
export async function advancedReport(actor:Employee,params:URLSearchParams) {
 const kind=(params.get("kind")??"compliance") as keyof typeof reportKinds;
 assert(kind in reportKinds,"Tipo de reporte inválido.");
 if(["review","audit","engine"].includes(kind))assert(isRh(actor),"Reporte reservado a RH.",403);
 const current=await currentRequirements(actor,params);
 const horizon=[7,30,60,90].includes(Number(params.get("horizon")))?Number(params.get("horizon")):30;
 let headers:string[]=[],rows:unknown[][]=[];
 if(kind==="executive") {const dash=await dashboardData(actor,params);headers=["Sede","Requisitos","Al día según registros","Cumplimiento"];rows=dash.bySite.map(s=>[s.site,s.total,s.compliant,s.percent===null?"Sin datos":`${s.percent}%`]);}
 if(kind==="compliance") {headers=["CPID","Empleado","Sede","Documento","Estado según registros","Vencimiento","Origen del registro","Archivos en sistema"];rows=current.map(r=>[r.cpid,r.name,r.site,r.document,r.state,displayDate(r.expiresDate),r.recordBasis==="IMPORTED_RECORD"?"Histórico importado":r.recordBasis==="APPROVED"?"Aprobación en plataforma":"Sin entrega registrada",r.attachmentCount]);}
 if(kind==="expiry") {headers=["CPID","Empleado","Sede","Documento","Fecha límite","Estado","Evidencia"];rows=current.filter(r=>r.days!==null&&r.days<=horizon).map(r=>[r.cpid,r.name,r.site,r.document,displayDate(r.dueDate),r.state,r.law&&!r.law.verified?"Fecha de ciclo estimada · emisión por verificar":"Fecha registrada"]);}
 if(kind==="law") {headers=["CPID","Empleado","Sede","Año del ciclo","Emisión","Renovación completa","Validación","Próxima acción","Fecha","Inicial · Ley 300 + antecedentes","Antecedentes año 2","Antecedentes año 3","Antecedentes año 4","Otras entregas históricas"];rows=current.filter(r=>r.law).map(r=>{const l=r.law!;return[r.cpid,r.name,r.site,l.year??"Sin determinar",displayDate(l.issueDate),displayDate(l.expiresDate),l.verified?"Verificado":l.source==="CALCULATED"?"Estimado · emisión calculada":"Por verificar",l.nextAction,displayDate(l.nextDate),...Array.from({length:4},(_,i)=>{const p=l.periods.find(x=>x.index===i+1);return p?`${displayDate(p.dueDate)} · ${p.state}${p.deliveredDate?` · entrega ${displayDate(p.deliveredDate)}`:""}`:i===0&&l.initialDeliveryDate?`Entrega ${displayDate(l.initialDeliveryDate)} · ciclo por verificar`:"Sin determinar"}),l.additionalDeliveries.map(displayDate).join(", ")]});}
 if(kind==="review"||kind==="history") {headers=["CPID","Empleado","Documento","Entrega","Estado","Responsable","Horas"];
 const visible=await reportRows(actor,params);
 const submissions=await db.submission.findMany({where:{obligationId:{in:visible.map(r=>r.id)},...(kind==="review"?{status:"PENDING"}:{}),...(params.get("from")||params.get("to")?{receivedDate:{...(params.get("from")?{gte:params.get("from")!}:{}),...(params.get("to")?{lte:params.get("to")!}:{})}}:{})},include:{employee:true,obligation:{include:{documentType:true}}},orderBy:{submittedAt:"desc"}});
 const users=await db.platformUser.findMany({select:{id:true,name:true}});
 rows=submissions.map(s=>[s.employee.cpid,s.employee.name,s.obligation.documentType.name,displayDate(s.receivedDate),statusNames[s.status]??s.status,users.find(u=>u.id===(s.reviewerId??s.assignedReviewerId))?.name??"Sin asignar",Math.round(((s.reviewedAt?.getTime()??Date.now())-s.submittedAt.getTime())/3600000)]);}
 if(kind==="audit") {headers=["Fecha","Acción","Responsable","Registro"];const logs=await db.audit.findMany({where:{...(params.get("from")||params.get("to")?{createdAt:{...(params.get("from")?{gte:new Date(`${params.get("from")}T00:00:00-04:00`)}:{}),...(params.get("to")?{lte:new Date(`${params.get("to")}T23:59:59.999-04:00`)}:{})}}:{})},orderBy:{createdAt:"desc"},take:1000});const users=await db.platformUser.findMany({select:{id:true,name:true}});rows=logs.map(a=>[a.createdAt.toISOString(),a.action,users.find(u=>u.id===a.actorId)?.name??"Sistema / histórico",a.entityId]);}
 if(kind==="engine") {headers=["Fecha","Tipo","Asunto","Estado","Intentos"];const notices=await db.notification.findMany({where:{kind:{not:"AUTH"}},orderBy:{createdAt:"desc"},take:1000});rows=notices.map(n=>[n.createdAt.toISOString(),n.kind,n.subject,n.status,n.attempts]);}
 return {kind,title:reportKinds[kind],headers,rows,asOf:new Date().toISOString(),filters:Object.fromEntries(params),count:rows.length};
}
export async function exportAdvancedReport(actor:Employee,params:URLSearchParams) {
 const report=await advancedReport(actor,params),format=params.get("format")==="pdf"?"pdf":"xlsx";
 const bytes=await brandedBytes(report.title,report.headers,report.rows,format,`Filtros: ${JSON.stringify(report.filters)}`);
 if(cloudStorage) {const key=`exports/${randomUUID()}.${format}`,filename=`upkeephr-${report.kind}-${localDate()}.${format}`,mime=format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";await storeObject("hhrr-reports",key,bytes,mime);await db.exportJob.create({data:{actorId:(actor as Employee&{accountId?:string}).accountId??actor.id,filename,storageKey:key,mime,filters:JSON.stringify(report.filters),rowCount:report.count}});return signedDownload("hhrr-reports",key,filename);}
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="upkeephr-${report.kind}-${localDate()}.${format}"`,"Cache-Control":"private, no-store"}});
}
export async function receipt(actor:Employee,id:string) {
 const s=await db.submission.findUniqueOrThrow({where:{id},include:{employee:true,obligation:{include:{documentType:true}},files:true}});
 assert(isRh(actor)||s.employeeId===actor.id,"Sin acceso a este comprobante.",403);
 const reviewer=s.reviewerId?await db.platformUser.findUnique({where:{id:s.reviewerId},select:{name:true}}):null;
 const fields:unknown[][]=[["Comprobante",s.id],["Empleado",`${s.employee.name} · ${s.employee.cpid}`],["Sede / puesto",`${s.employee.site} · ${s.employee.position}`],["Documento",s.obligation.documentType.name],["Entrega",displayDate(s.receivedDate)],["Estado",statusNames[s.status]??s.status],["Revisión",s.reviewedAt?.toLocaleString("es-PR",{timeZone:"America/Puerto_Rico"})??"Pendiente"],["Responsable",reviewer?.name??"—"],["Motivo",s.reason??"—"],...s.files.flatMap(f=>[["Archivo",f.filename],["SHA-256",f.sha256]])];
 const bytes=await brandedBytes("Comprobante de entrega y revisión",["Campo","Detalle"],fields,"pdf","Generado desde el expediente y su historial.");
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="comprobante-${s.id}.pdf"`,"Cache-Control":"no-store"}});
}
