import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PDFDocument} from "pdf-lib";
import ExcelJS from "exceljs";
import {createOTP} from "@better-auth/utils/otp";
import {base32} from "@better-auth/utils/base32";
process.loadEnvFile(".env.local");process.loadEnvFile(process.env.APP_ENV_FILE!);
assert.equal(process.env.DATABASE_SCHEMA,"hhrr_test","HTTP smoke never creates production fixtures.");
const {db}=await import("../src/lib/db");
const {savePlatformUser,createActivation,activateAccount}=await import("../src/lib/platform-users");
const {saveEmployee}=await import("../src/lib/compliance");
const {localDate,addDays,addMonths}=await import("../src/lib/domain");
const root=process.env.APP_URL!;
type Actor=Parameters<typeof saveEmployee>[0];
const admin={id:randomUUID(),role:"SUPERADMIN"} as Actor;
const suffix=randomUUID().slice(0,8),password=`Smoke-only-${randomUUID()}`;
class Client {
 jar=new Map<string,string>();
 cookie(){return [...this.jar].map(([k,v])=>`${k}=${v}`).join("; ");}
 async call(route:string,body?:unknown,method=body?"POST":"GET") {const r=await fetch(`${root}/api/${route}`,{method,headers:{cookie:this.cookie(),origin:root,"x-rh-request":"1",...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});for(const c of r.headers.getSetCookie()){const p=c.split(";")[0],i=p.indexOf("=");if(p.slice(i+1))this.jar.set(p.slice(0,i),p.slice(i+1));else this.jar.delete(p.slice(0,i));}return r;}
 async json(route:string,body?:unknown,method?:string){const r=await this.call(route,body,method),d=await r.json();assert.equal(r.status,200,`${route}: ${d.error??d.message??r.status}`);return d;}
}
async function account(role:string,employeeId?:string){const email=`smoke-${role.toLowerCase()}-${suffix}@example.test`,user=await savePlatformUser(admin,{name:`Prueba ${role}`,email,role,employeeId:employeeId??null});const url=await createActivation(user.id);await activateAccount({token:url.split("#")[1],password});const client=new Client();await client.json("login",{identifier:email,password});if(["RH","SUPERADMIN"].includes(role)){assert.equal((await client.call("state")).status,403);const enrollment=await client.json("auth/two-factor/enable",{password});const secret=new TextDecoder().decode(base32.decode(new URL(enrollment.totpURI).searchParams.get("secret")!));await client.json("auth/two-factor/verify-totp",{code:await createOTP(secret).totp()});}return {user,client};}
const rh=await account("RH");
const supervisor=await saveEmployee(admin,{cpid:`SM-S-${suffix}`,name:"Supervisora prueba",lastNames:"Prueba",email:`sup-${suffix}@example.test`,role:"SUPERVISOR",site:"SEDE PRUEBA",position:"Supervisora",hireDate:localDate()});
const employee=await rh.client.json("employees",{cpid:`SM-E-${suffix}`,name:"Empleado recorrido",lastNames:"Recorrido",email:`emp-${suffix}@example.test`,role:"EMPLOYEE",site:"SEDE PRUEBA",position:"Maestra",hireDate:localDate(),active:true,supervisorId:supervisor.id});
const emp=await account("EMPLOYEE",employee.id),sup=await account("SUPERVISOR",supervisor.id);
const spec={name:`Documento recorrido ${suffix}`,description:"Prueba integrada",instructions:"Entregar un PDF legible.",autoAssign:false,expiryMode:"PROVIDED",validityMonths:12,initialDays:30,calendarMode:"CLAMP",reviewMonths:null,reviewCount:null,reviewTargetId:null,reminders:[10,5,0],overdueDays:7,sites:[],positions:[]};
const document=await rh.client.json("documents",spec);
await rh.client.json("assignments",{employeeId:employee.id,documentTypeId:document.id,dueDate:addDays(localDate(),5)});
let state=await emp.client.json("state");const obligation=state.obligations.find((o:{documentTypeId:string})=>o.documentTypeId===document.id);
const pdf=await PDFDocument.create();pdf.addPage().drawText("UpKeepHR - comprobante de prueba");const small=await pdf.save();
await fs.mkdir("test-results",{recursive:true});await fs.writeFile("test-results/documento-prueba.pdf",small);
const big=Buffer.alloc(10*1024*1024,32);Buffer.from(small).copy(big);
assert.equal((await emp.client.call("uploads",{obligationId:obligation.id,files:[{filename:"too-big.pdf",mime:"application/pdf",size:big.length+1}]})).status,400);
async function upload(bytes:Uint8Array,obligationId=obligation.id){const slot=await emp.client.json("uploads",{obligationId,files:[{filename:"certificado.pdf",mime:"application/pdf",size:bytes.length}]});const put=await fetch(slot.files[0].url,{method:"PUT",headers:{"Content-Type":"application/pdf"},body:new Uint8Array(bytes)});assert.equal(put.status,200,"Direct private 10 MB upload");return emp.client.json("submissions/complete",{uploadId:slot.id,issueDate:localDate(),expiresDate:addDays(localDate(),365)});}
const first=await upload(big);const attachment=await db.attachment.findFirstOrThrow({where:{submissionId:first.id}});
assert.equal((await sup.client.call(`files/${attachment.id}`)).status,403);
assert.equal((await emp.client.call(`files/${attachment.id}`)).status,200);
assert.equal((await emp.client.call(`submissions/${first.id}/review`,{approve:true})).status,403);
await rh.client.json(`submissions/${first.id}/assign-reviewer`,{reviewerId:rh.user.id},"PATCH");
await rh.client.json(`submissions/${first.id}/review`,{approve:false,reason:"Corrige la copia"});
const corrected=await upload(small);await rh.client.json(`submissions/${corrected.id}/review`,{approve:true,issueDate:localDate(),expiresDate:addDays(localDate(),365)});
state=await emp.client.json("state");assert.equal(state.dashboard.percent,100);assert.equal(state.obligations.find((o:{id:string})=>o.id===obligation.id).state,"CUMPLIDA");
const report=await emp.client.json(`reports?kind=compliance&document=${document.id}`);assert.equal(report.count,1);assert.equal(report.rows[0][4],"VIGENTE");
const xlsx=await emp.client.call(`reports/export?kind=compliance&document=${document.id}&format=xlsx`);assert.equal(xlsx.status,200);const book=new ExcelJS.Workbook();await book.xlsx.load(await xlsx.arrayBuffer());assert.equal(book.worksheets[0].getRow(9).getCell(1).value,employee.cpid);assert.equal(book.worksheets[0].getImages().length,1);
const receipt=await emp.client.call(`submissions/${corrected.id}/receipt`);assert.equal(receipt.status,200);await fs.writeFile("test-results/receipt.pdf",Buffer.from(await receipt.arrayBuffer()));
const doc2=await rh.client.json("documents",{...spec,name:`Recordatorio recorrido ${suffix}`});await rh.client.json("assignments",{employeeId:employee.id,documentTypeId:doc2.id,dueDate:addDays(localDate(),5)});
await rh.client.json("motor/tick",{});assert.equal(await db.notification.count({where:{status:{in:["ACCEPTED","DELIVERED"]}}}),0);assert.equal(process.env.EMAIL_ENABLED,"false");
assert.equal((await emp.client.call("users")).status,403);assert.equal((await rh.client.call("users",{name:"Prohibido",email:`denied-${suffix}@example.test`,role:"RH"})).status,403);
const law=await db.documentType.findUniqueOrThrow({where:{code:"LEY300"}});
await rh.client.json("assignments",{employeeId:employee.id,documentTypeId:law.id});
state=await emp.client.json("state");const lawInitial=state.obligations.find((o:{documentTypeId:string;kind:string})=>o.documentTypeId===law.id&&o.kind==="INITIAL");
const lawBundle=await upload(small,lawInitial.id);
assert.equal((await rh.client.call(`submissions/${lawBundle.id}/review`,{approve:true})).status,400,"Ley 300 approval requires the initial background confirmation through HTTP");
await rh.client.json(`submissions/${lawBundle.id}/review`,{approve:true,initialBackgroundConfirmed:true});
state=await emp.client.json("state");const currentLaw=state.dashboard.rows.find((r:{documentTypeId:string})=>r.documentTypeId===law.id).law;
assert.equal(currentLaw.periods[0].state,"APROBADA");assert.equal(currentLaw.periods[0].deliveredDate,localDate());
assert.deepEqual(currentLaw.periods.map((p:{dueDate:string})=>p.dueDate),[localDate(),...Array.from({length:3},(_,i)=>addMonths(localDate(),(i+1)*12,"ANNIVERSARY"))]);
const cycle=await db.cycle.findFirstOrThrow({where:{employeeId:employee.id,documentTypeId:law.id,active:true}});
assert.equal(cycle.expiresDate,addMonths(localDate(),60,"ANNIVERSARY"));assert.equal(await db.obligation.count({where:{cycleId:cycle.id,kind:"REVIEW"}}),3);
const lawReport=await emp.client.json(`reports?kind=law&document=${law.id}`);assert.equal(lawReport.count,1);assert.match(lawReport.headers[9],/Inicial/);assert.match(lawReport.rows[0][9],/APROBADA/);
await fs.writeFile("test-results/browser-rh-cookies.txt",`curl '${root}' -H 'Cookie: ${rh.client.cookie()}'`);await fs.writeFile("test-results/browser-employee-cookies.txt",`curl '${root}' -H 'Cookie: ${emp.client.cookie()}'`);
await fs.writeFile("test-results/smoke-fixture.json",JSON.stringify({employeeId:employee.id,cpid:employee.cpid,documentId:doc2.id,userId:rh.user.id,supervisorId:supervisor.id}));
console.log("HTTP verificado: MFA, creación RH, carga privada real 10 MB, aislamiento, rechazo, corrección, aprobación, dashboard, Excel con logo, comprobante, primera verificación Ley 300, tres años posteriores y correos deshabilitados.");
await db.$disconnect();
