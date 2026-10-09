import type {LawOverview} from "@/lib/law-cycle";
const date=(v:string|null)=>v?`${v.slice(5,7)}/${v.slice(8,10)}/${v.slice(0,4)}`:"Sin fecha";
const states:Record<string,string>={APROBADA:"Aprobada",REGISTRADA_SIN_VALIDAR:"Entrega histórica registrada",FECHA_POR_VERIFICAR:"Fecha registrada por cotejar",VENCIDA:"Vencida",VENCIDA_ESTIMADA:"Sin entrega · fecha estimada vencida",PROGRAMADA:"Programada",VENCE_HOY:"Vence hoy"};
export function LawCycleCard({law}:{law:LawOverview|null}) {
 if(!law)return <p className="muted">Ley 300 sin asignación activa.</p>;
 return <section className="panel cloud-panel law-card"><h3>Ley 300 · {law.year?`año ${law.year} de 5`:"año sin determinar"}{!law.verified?" · estimado":" · verificado"}</h3>
 <p>Emisión {date(law.issueDate)} · renovación completa {date(law.expiresDate)}</p>
 {law.warning&&<p className="notice">{law.warning}</p>}
 <p>La primera verificación se entrega junto a Ley 300; después se entregan antecedentes de los años 2, 3 y 4. La renovación completa usa el vencimiento registrado y vuelve a iniciar el ciclo.</p>
 <p><strong>{law.recordedCurrent?"Al día según registros":law.stage==="POR_VERIFICAR"?"Fechas por verificar":"Requiere atención"}</strong> · {law.overdueReviews} verificaciones atrasadas sin entrega registrada{law.uncertainReviews?` · ${law.uncertainReviews} fechas por cotejar`:""}.</p>
 <p><strong>{law.nextAction}</strong> · {date(law.nextDate)}{law.stage==="RENOVACION_VENCIDA"?" · VENCIDA":""}</p>
 <div className="table-wrap"><table><thead><tr><th>Verificación</th><th>Fecha de verificación</th><th>Entrega registrada</th><th>Estado</th></tr></thead><tbody>{law.periods.map(p=><tr key={p.index}><td>{p.index===1?"Ley 300 + antecedentes · año 1":`Antecedentes · año ${p.index}`}</td><td>{date(p.dueDate)}</td><td>{date(p.deliveredDate)}</td><td>{states[p.state]??p.state}</td></tr>)}</tbody></table></div>
 {law.additionalDeliveries.length>0&&<p className="muted">Otras entregas históricas registradas: {law.additionalDeliveries.map(date).join(", ")}. Se conservan como historial adicional.</p>}
 {!law.periods.length&&<p className="muted">No se calculan aniversarios mientras la emisión sea desconocida o futura.</p>}
 {!law.periods.length&&law.initialDeliveryDate&&<p className="muted">Primera entrega registrada: {date(law.initialDeliveryDate)}.</p>}
 </section>;
}
