import test from "node:test";
import assert from "node:assert/strict";
if(!process.env.DATABASE_URL){process.loadEnvFile(".env.local");process.loadEnvFile(process.env.APP_ENV_FILE!);}
assert.equal(process.env.DATABASE_SCHEMA,"hhrr_test");
const {lawOverview}=await import("../src/lib/law-cycle");
const {employeeCompliance}=await import("../src/lib/filtering");
const rule={reviewMonths:12,reviewCount:4,validityMonths:60,calendarMode:"ANNIVERSARY"};
test("Imported Ley 300 shows estimated year and evidence without inventing approval",()=>{
 const law=lawOverview("2026-10-07",{issueDate:"2024-06-10",expiresDate:"2029-06-10",issueDerived:true},false,rule,[],["2024-06-12","2025-11-12",null,null,null]);
 assert.equal(law.year,3);assert.equal(law.source,"CALCULATED");assert.equal(law.verified,false);assert.equal(law.periods.length,4);assert.equal(law.periods[0].state,"REGISTRADA_SIN_VALIDAR");assert.equal(law.periods[2].state,"VENCIDA_ESTIMADA");assert.equal(law.nextAction,"Antecedentes · año 3");assert.equal(law.overdueReviews,1);
 assert.equal(law.recordedCurrent,false);
});
test("Imported annual history counts without a file or fabricated approval, while gaps and renewal still matter",()=>{
 const base={issueDate:"2024-02-29",expiresDate:"2029-03-01",issueDerived:true};
 const history=["2024-03-03","2025-03-04","2026-03-02",null,null];
 const current=lawOverview("2026-10-07",base,false,rule,[],history);
 assert.equal(current.recordedCurrent,true);assert.equal(current.verified,false);assert.equal(current.stage,"AL_DIA");assert.equal(current.nextDate,"2027-03-01");assert.equal(current.periods[0].state,"REGISTRADA_SIN_VALIDAR");
 assert.equal(lawOverview("2026-10-07",base,false,rule,[],[history[0],history[1],null,null,null]).recordedCurrent,false);
 assert.equal(lawOverview("2030-01-01",base,false,rule,[],history).recordedCurrent,false);
 assert.equal(lawOverview("2026-01-01",{issueDate:"2027-01-01",expiresDate:"2032-01-01"},false,rule,[],history).recordedCurrent,false);
 assert.equal(lawOverview("2026-01-01",null,false,rule,[],history).recordedCurrent,false);
});
test("Ley 300 leap anniversary, complete renewal and future/missing issue are explicit",()=>{
 const leap=lawOverview("2025-03-01",{issueDate:"2024-02-29",expiresDate:"2029-03-01"},true,rule,[],[],{deliveredDate:"2024-03-01",approved:true});
 assert.equal(leap.year,2);assert.equal(leap.periods[1].dueDate,"2025-03-01");assert.equal(leap.periods[1].state,"VENCE_HOY");
 const expired=lawOverview("2026-10-07",{issueDate:"2020-09-01",expiresDate:"2025-09-01",issueDerived:true},false,rule,[]);
 assert.equal(expired.stage,"RENOVACION_VENCIDA");assert.equal(expired.nextDate,"2025-09-01");assert.equal(expired.nextAction,"Renovar certificación completa");
 const future=lawOverview("2026-10-07",{issueDate:"2026-11-01",expiresDate:"2031-11-01",issueDerived:true},false,rule,[]);
 assert.equal(future.year,null);assert.equal(future.periods.length,0);assert.match(future.warning!,/futura/);
 const missing=lawOverview("2026-10-07",null,false,rule,[]);assert.equal(missing.year,null);assert.equal(missing.nextDate,null);
});
test("Initial verification uses Ley 300 delivery, later years retain emission anniversaries and original expiry",()=>{
 const dates=["2026-04-20",null,null,null,null],base={issueDate:"2026-04-17",expiresDate:"2031-04-17",issueDerived:true};
 const before=JSON.stringify({dates,base}),law=lawOverview("2026-10-07",base,false,rule,[],dates);
 assert.deepEqual(law.periods.map(p=>[p.index,p.dueDate]),[[1,"2026-04-20"],[2,"2027-04-17"],[3,"2028-04-17"],[4,"2029-04-17"]]);
 assert.equal(law.nextAction,"Antecedentes · año 2");assert.equal(law.recordedCurrent,true);assert.equal(law.expiresDate,"2031-04-17");assert.equal(JSON.stringify({dates,base}),before);
 const completed=lawOverview("2030-05-01",base,false,rule,[],["2026-04-20","2027-04-17","2028-04-18","2029-04-17","2030-04-17"]);
 assert.equal(completed.periods.length,4);assert.equal(completed.nextDate,"2031-04-17");assert.equal(completed.nextAction,"Renovación completa · vencimiento registrado");assert.deepEqual(completed.additionalDeliveries,["2030-04-17"]);
 const conflict=lawOverview("2026-10-07",base,false,rule,[],["2025-04-20",null,null,null,null]);
 assert.equal(conflict.periods[0].deliveredDate,"2025-04-20");assert.equal(conflict.periods[0].state,"FECHA_POR_VERIFICAR");assert.equal(conflict.recordedCurrent,false);
});
test("An active employee with one expired document is overdue, while zero assignments never means compliant",()=>{
 const valid={compliant:true,overdue:false,pendingReview:false};
 assert.equal(employeeCompliance([valid,{compliant:false,overdue:true,pendingReview:true}]),"VENCIDA");
 assert.equal(employeeCompliance([valid]),"VIGENTE");assert.equal(employeeCompliance([]),"SIN_REQUISITOS");
 assert.equal(employeeCompliance([valid],false),"INACTIVO");
 assert.equal(employeeCompliance([{compliant:false,overdue:false,pendingReview:false,law:{verified:false}}]),"POR_VERIFICAR");
 assert.equal(employeeCompliance([{...valid,law:{verified:false}},{compliant:false,overdue:false,pendingReview:false}]),"PENDIENTE");
});
