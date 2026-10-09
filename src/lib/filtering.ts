export function employeeCompliance(rows:{overdue:boolean;compliant:boolean;pendingReview:boolean;law?:{verified:boolean}|null}[],active=true) {
 if(!active)return "INACTIVO";
 if(!rows.length)return "SIN_REQUISITOS";
 if(rows.some(r=>r.overdue))return "VENCIDA";
 if(rows.every(r=>r.compliant))return "VIGENTE";
 if(rows.some(r=>r.pendingReview))return "EN_REVISION";
 if(rows.some(r=>!r.compliant&&r.law&&!r.law.verified))return "POR_VERIFICAR";
 return "PENDIENTE";
}
export function matchesCurrent(row:{state:string;compliant:boolean;pendingReview:boolean;days:number|null;[key:string]:unknown},filters:Record<string,string>,query="") {
 if(query&&!`${row.name} ${row.cpid} ${row.document}`.toLowerCase().includes(query.toLowerCase()))return false;
 return Object.entries(filters).every(([key,value])=>{
  if(!value||key==="q"||key==="kind"||key==="horizon"||key==="from"||key==="to"||key==="format")return true;
  if(key!=="state")return String(row[key==="supervisor"?"supervisorId":key==="document"?"documentTypeId":key==="employee"?"employeeId":key])===value;
  if(value==="CUMPLIDA"||value==="VIGENTE")return row.compliant;
  if(value==="EN_REVISION")return row.pendingReview;
  if(value==="VENCIDA")return row.overdue===true;
  if(value==="VENCE_HOY")return row.days===0;
  if(value==="URGENTE")return row.days!==null&&row.days>0&&row.days<=5;
  if(value==="POR_VENCER")return row.days!==null&&row.days>5&&row.days<=10;
  return row.state===value;
 });
}
