import {z} from "zod";
import {createHash,randomUUID} from "node:crypto";
import {db} from "./db";
import {assert,addDays,localDate,validDate} from "./domain";
import {audit,isRh} from "./compliance";
import type {Actor} from "./auth";
const schema=z.object({documentTypeId:z.uuid(),site:z.string().default(""),position:z.string().default(""),dueDate:z.string().default(""),digest:z.string().optional()});
export async function bulkAssignments(actor:Actor,input:unknown,confirm=false) {
 assert(isRh(actor),"Acceso RH requerido.",403);const data=schema.parse(input);
 assert(!data.dueDate||validDate(data.dueDate),"Fecha límite inválida.");
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(7364032)`;
  const document=await tx.documentType.findUniqueOrThrow({where:{id:data.documentTypeId},include:{rules:{orderBy:{version:"desc"},take:1}}});assert(document.active&&document.rules[0],"Documento inactivo.");
  const employees=await tx.employee.findMany({where:{active:true,...(data.site?{site:data.site}:{}),...(data.position?{position:data.position}:{})},include:{assignments:{where:{documentTypeId:data.documentTypeId,active:true}}},orderBy:{id:"asc"}});
  assert(employees.length<=500,"Asigna por sede o puesto: máximo 500 empleados por operación.");
  const rows=employees.map(e=>({id:e.id,name:e.name,cpid:e.cpid,dueDate:data.dueDate||addDays(e.hireDate>localDate()?e.hireDate:localDate(),document.rules[0].initialDays),alreadyAssigned:!!e.assignments.length}));
  const digest=createHash("sha256").update(JSON.stringify({rule:document.rules[0].id,rows})).digest("hex");
  if(confirm){
   assert(data.digest===digest,"Cambió la vista previa. Revísala nuevamente.",409);
   const affected=rows.filter(r=>!r.alreadyAssigned),existing=await tx.assignment.findMany({where:{documentTypeId:document.id,employeeId:{in:affected.map(r=>r.id)}}});
   const values=affected.map(row=>({row,existing:existing.find(a=>a.employeeId===row.id),id:existing.find(a=>a.employeeId===row.id)?.id??randomUUID()}));
   await tx.assignment.createMany({data:values.filter(v=>!v.existing).map(v=>({id:v.id,employeeId:v.row.id,documentTypeId:document.id,ruleId:document.rules[0].id,assignedDate:localDate()}))});
   await tx.assignment.updateMany({where:{id:{in:values.filter(v=>v.existing).map(v=>v.id)}},data:{active:true,ruleId:document.rules[0].id,assignedDate:localDate()}});
   await tx.obligation.createMany({data:values.map(v=>({key:`${v.id}:bulk:${randomUUID()}`,employeeId:v.row.id,documentTypeId:document.id,assignmentId:v.id,ruleId:document.rules[0].id,kind:"INITIAL",dueDate:v.row.dueDate}))});
   await audit(tx,actor.accountId,"BULK_ASSIGNMENTS",document.id,{employees:affected.map(r=>r.id)});
  }
  return {digest,rows};
 },{timeout:25000});
}
