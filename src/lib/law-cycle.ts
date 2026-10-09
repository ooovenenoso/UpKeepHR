import {addMonths,validDate} from "./domain";
export interface LawPeriod {index:number;dueDate:string;deliveredDate:string|null;state:string}
export interface LawOverview {
 source:"VERIFIED"|"CALCULATED"|"IMPORTED"|"MISSING";verified:boolean;issueDate:string|null;expiresDate:string|null;
 year:number|null;stage:string;warning:string|null;periods:LawPeriod[];nextDate:string|null;nextAction:string;overdueReviews:number;recordedCurrent:boolean;uncertainReviews:number;initialDeliveryDate:string|null;additionalDeliveries:string[];
}
type Evidence={issueDate:string|null;expiresDate:string|null;issueDerived?:boolean};
export function lawOverview(today:string,base:Evidence|null,verified:boolean,rule:{reviewMonths:number|null;reviewCount:number|null;validityMonths:number|null;calendarMode:string},reviews:{reviewIndex:number|null;dueDate:string;status:string;fulfilledDate:string|null}[],legacyRevisions:(string|null)[]=[],initial?:{deliveredDate:string|null;approved:boolean}):LawOverview {
 const issue=validDate(base?.issueDate)?base.issueDate:null;
 const expires=validDate(base?.expiresDate)?base.expiresDate:issue&&rule.validityMonths?addMonths(issue,rule.validityMonths,rule.calendarMode):null;
 const source=verified?"VERIFIED":issue?(base?.issueDerived?"CALCULATED":"IMPORTED"):"MISSING";
 const future=!!issue&&issue>today;
 const warning=future?"La emisión registrada es futura; requiere corrección de RH.":!issue?"Falta la emisión original para determinar el ciclo.":!verified?"El ciclo se calcula con las fechas importadas; la emisión original está pendiente de validación. Las entregas históricas cuentan como registradas, aunque no tengan archivo digital. No se convierten en aprobaciones nuevas.":null;
 const initialRaw=initial?.deliveredDate??(!verified?legacyRevisions[0]:null);
 const initialDeliveryDate=validDate(initialRaw)?initialRaw:null;
 const count=rule.reviewCount??4;
 const periods:LawPeriod[]=issue&&!future?Array.from({length:count},(_,i)=>{
  const index=i+1,obligation=reviews.find(r=>r.reviewIndex===index);
  const dueDate=index===1?(initialDeliveryDate??issue):obligation?.dueDate??addMonths(issue,(index-1)*(rule.reviewMonths??12),rule.calendarMode);
  const raw=index===1?initialRaw:verified?obligation?.fulfilledDate:legacyRevisions[index-1];
  const deliveredDate=validDate(raw)?raw:null;
  const invalid=!!deliveredDate&&(deliveredDate>today||deliveredDate<issue);
  const approved=verified&&(index===1?initial?.approved:obligation?.status==="FULFILLED");
  return{index,dueDate,deliveredDate,state:invalid?"FECHA_POR_VERIFICAR":approved&&deliveredDate?"APROBADA":!verified&&deliveredDate?"REGISTRADA_SIN_VALIDAR":dueDate<today?(verified?"VENCIDA":"VENCIDA_ESTIMADA"):dueDate===today?"VENCE_HOY":"PROGRAMADA"};
 }):[];
 const overdueReviews=periods.filter(p=>["VENCIDA","VENCIDA_ESTIMADA"].includes(p.state)).length;
 const uncertainReviews=periods.filter(p=>p.state==="FECHA_POR_VERIFICAR").length;
 const first=periods.find(p=>!["APROBADA","REGISTRADA_SIN_VALIDAR"].includes(p.state));
 const expired=!!expires&&expires<today;
 const initialComplete=!!periods[0]&&["APROBADA","REGISTRADA_SIN_VALIDAR"].includes(periods[0].state);
 const recordedCurrent=!!issue&&!future&&!!expires&&!expired&&initialComplete&&overdueReviews===0&&uncertainReviews===0;
 const duration=Math.max(1,Math.ceil((rule.validityMonths??60)/12));
 let year=issue&&!future?1:null;
 if(issue&&!future)for(let y=1;y<duration;y++)if(addMonths(issue,y*12,rule.calendarMode)<=today)year=y+1;
 const stage=expired?"RENOVACION_VENCIDA":future||!issue||!expires||uncertainReviews?"POR_VERIFICAR":overdueReviews?"REVISION_VENCIDA":!initialComplete?"PENDIENTE":"AL_DIA";
 const nextDate=expired?expires:first?.dueDate??expires;
 const nextAction=expired?"Renovar certificación completa":future?"Corregir emisión futura":!issue?"Verificar emisión original":first?.state==="FECHA_POR_VERIFICAR"?`Validar fecha de entrega · antecedentes año ${first.index}`:first?.index===1?"Ley 300 + antecedentes · primera verificación":first?`Antecedentes · año ${first.index}`:"Renovación completa · vencimiento registrado";
 const additionalDeliveries=legacyRevisions.slice(count).filter((v):v is string=>validDate(v));
 return{source,verified,issueDate:issue,expiresDate:expires,year,stage,warning,periods,nextDate,nextAction,overdueReviews,recordedCurrent,uncertainReviews,initialDeliveryDate,additionalDeliveries};
}
