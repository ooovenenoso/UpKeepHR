import { matchesCurrent } from "./filtering";
import { db } from "./db";
import { visibility } from "./compliance";
import { localDate, daysBetween } from "./domain";
import {lawOverview} from "./law-cycle";
import {complianceSummary} from "./compliance-metrics";
export {complianceSummary} from "./compliance-metrics";
import type { Employee } from "../generated/prisma/client";
export async function currentRequirements(viewer:Employee, params=new URLSearchParams(),today=localDate()) {
 const document=params.get("document")??params.get("documentTypeId");
 const assignments=await db.assignment.findMany({where:{active:true,employee:{...visibility(viewer),active:true,...(params.get("employee")?{id:params.get("employee")!}:{}),...(params.get("site")?{site:params.get("site")!}:{}),...(params.get("position")?{position:params.get("position")!}:{}),...(params.get("supervisor")?{supervisorId:params.get("supervisor")!}:{}),...(params.get("source")?{source:params.get("source")!}:{})},...(document?{documentTypeId:document}:{})},include:{employee:true,rule:true,documentType:true,obligations:{include:{cycle:true,submissions:{orderBy:{submittedAt:"desc"},select:{id:true,status:true,issueDate:true,expiresDate:true,receivedDate:true,submittedAt:true,assignedReviewerId:true,_count:{select:{files:true}}}}},orderBy:{createdAt:"desc"}}}});
 const employeeIds=[...new Set(assignments.map(a=>a.employeeId))];
 const cycles=await db.cycle.findMany({where:{employeeId:{in:employeeIds},active:true},include:{rule:true},orderBy:{createdAt:"desc"}});
 return assignments.map(a=>{
   const base=cycles.find(c=>c.employeeId===a.employeeId&&c.documentTypeId===a.documentTypeId);
   const active=a.obligations.filter(o=>o.status!=="CANCELLED"&&(!o.cycleId||o.cycle?.active));
   let legacy:{documents?:Record<string,{issueDate:string|null;expiresDate:string|null;issueDerived:boolean}>;revisions?:(string|null)[]}|null=null;
   try{legacy=a.employee.legacyData?JSON.parse(a.employee.legacyData):null;}catch{}
   const approvedBase=base?a.obligations.filter(o=>o.kind!=="REVIEW").flatMap(o=>o.submissions).find(s=>s.status==="APPROVED"&&s.issueDate===base.issueDate):null;
   const law=a.documentType.code==="LEY300"?lawOverview(today,base??legacy?.documents?.LEY300??null,base?.verified??false,base?.rule??a.rule,active.filter(o=>o.kind==="REVIEW"&&(!base||o.cycleId===base.id)),legacy?.revisions,approvedBase?{deliveredDate:approvedBase.receivedDate,approved:true}:undefined):null;
   const expiresDate=base?.expiresDate??law?.expiresDate??null;
   const valid=!!base?.verified&&(!expiresDate||expiresDate>=today);
   const lateReview=law?law.overdueReviews>0:active.some(o=>o.kind==="REVIEW"&&o.dueDate<today&&o.status!=="FULFILLED");
   const pendingSubmissions=active.filter(o=>o.status==="OPEN").flatMap(o=>o.submissions.filter(s=>s.status==="PENDING").map(s=>({id:s.id,submittedAt:s.submittedAt.toISOString(),assignedReviewerId:s.assignedReviewerId})));
   const pending=pendingSubmissions.length>0;
   const initial=active.find(o=>o.kind==="INITIAL"&&o.status==="OPEN");
   const open=active.filter(o=>o.status==="OPEN").sort((x,y)=>x.dueDate.localeCompare(y.dueDate));
   const expired=!!expiresDate&&expiresDate<today;
   const compliant=law?law.recordedCurrent:valid&&!lateReview;
   const overdue=expired||lateReview||(!base&&!law?.expiresDate&&!!initial&&initial.dueDate<today);
   const state=expired?"VENCIDA":lateReview?"REVISION_VENCIDA":pending&&!compliant?"EN_REVISION":compliant?"VIGENTE":law?.stage==="POR_VERIFICAR"?"POR_VERIFICAR":overdue?"VENCIDA":"PENDIENTE";
   const dueDate=law&&!law.verified?law.nextDate:open[0]?.dueDate??expiresDate;
   const recordBasis=base?(["IMPORT","VERIFIED_IMPORT"].includes(base.origin)?"IMPORTED_RECORD":"APPROVED"):law?.issueDate&&law?.expiresDate?"IMPORTED_RECORD":"NONE";
   const attachmentCount=a.obligations.reduce((n,o)=>n+o.submissions.reduce((m,s)=>m+s._count.files,0),0);
   return {id:a.id,employeeId:a.employeeId,name:a.employee.name,cpid:a.employee.cpid,site:a.employee.site,position:a.employee.position,supervisorId:a.employee.supervisorId,source:a.employee.source,document:a.documentType.name,documentTypeId:a.documentTypeId,compliant,state,pendingReview:pending,pendingSubmissions,overdue,certificateExpired:expired,reviewOverdue:lateReview,attachmentCount,recordBasis,issueDate:base?.issueDate??law?.issueDate??null,expiresDate,expiryDays:expiresDate?daysBetween(expiresDate,today):null,dueDate,days:dueDate?daysBetween(dueDate,today):null,verified:base?.verified??false,cycleId:base?.id??null,law};
 }).filter(r=>matchesCurrent(r,Object.fromEntries(params),params.get("q")??""));
}
export type CurrentRequirement=Awaited<ReturnType<typeof currentRequirements>>[number];
export async function dashboardData(viewer:Employee,params=new URLSearchParams(),now=new Date()) {
 const rows=await currentRequirements(viewer,params,localDate(now)),summary=complianceSummary(rows);
 const pending=summary.pendingSubmissions;
 const bySite=[...new Set(rows.map(r=>r.site))].map(site=>{const group=rows.filter(r=>r.site===site),s=complianceSummary(group);return{site,total:group.length,compliant:s.compliant,percent:s.percent}});
 const trend=await db.dailySnapshot.findMany({orderBy:{date:"desc"},take:30});
 const scopes=new Set(rows.map(r=>r.id));
 return {asOf:now.toISOString(),...summary,older48h:pending.filter(s=>now.getTime()-new Date(s.submittedAt).getTime()>=48*3600000).length,unassigned:pending.filter(s=>!s.assignedReviewerId).length,bySite,trend:trend.reverse().map(s=>{const points=JSON.parse(s.metrics) as {id:string;employeeId:string;compliant:boolean}[];const group=points.filter(p=>scopes.has(p.id));return{date:s.date,total:group.length,percent:group.length?Math.round(group.filter(p=>p.compliant).length/group.length*100):null}}),rows};
}
export async function recordDailySnapshot(now=new Date()) {
 const rows=await currentRequirements({role:"SUPERADMIN"} as Employee,new URLSearchParams(),localDate(now));
 await db.dailySnapshot.upsert({where:{date:localDate(now)},create:{date:localDate(now),metrics:JSON.stringify(rows)},update:{metrics:JSON.stringify(rows),createdAt:now}});
}
