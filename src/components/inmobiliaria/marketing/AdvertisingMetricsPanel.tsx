'use client'

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import type { MarketingFunnelReport } from '@/services/marketingFunnel.service'
import { buildAdvertisingPanel, type PanelFilters, type PanelMetric, type PanelSummary } from '@/services/advertisingPanel.logic'
import { listFunnelLeadDetails, type FunnelLeadDetailRow } from '@/app/inmobiliaria/marketing/metricas/actions'
import { listTeamProfilesAction } from '@/app/inmobiliaria/leads/actions'
import { LeadDetailModal } from '@/components/inmobiliaria/leads/LeadDetailModal'
import type { TeamProfile } from '@/types/inmobiliaria'
import { MetricHelp } from './AccessibleMetricHelp'
import { PropertyIdentificationDialog } from './PropertyIdentificationDialog'

type VisibleMetric=Exclude<PanelMetric,'responded'|'unanswered'|'verify'>
const labels:Record<VisibleMetric,string>={contacts:'Contactos nuevos',hot:'Calientes',warm:'Tibios',cold:'Fríos',unevaluated:'Sin clasificar'}
const descriptions:Record<VisibleMetric,string>={
 contacts:'Personas registradas en el CRM durante las fechas elegidas y atribuidas una sola vez a su primer anuncio verificable. No cuenta clics ni conversaciones de Meta.',
 hot:'Contactos adquiridos en el período con nivel de interés alto registrado actualmente en el CRM. No garantiza una venta. La fecha de evaluación aparece en el detalle.',
 warm:'Contactos adquiridos en el período con nivel de interés medio registrado actualmente. No describe necesariamente su interés cuando llegaron.',
 cold:'Contactos adquiridos en el período que aparecen como Frío en la vista de contactos del CRM, incluido el valor inicial. La clasificación no demuestra por sí sola una evaluación.',
 unevaluated:'Contactos atribuidos cuyo nivel no está disponible o no se reconoce. La ausencia de fecha de evaluación no cambia la clasificación que muestra el CRM.',
}
const expenseHelp='Gasto reportado por Meta para los anuncios y las fechas seleccionadas, en la zona horaria de la cuenta publicitaria. Cada anuncio se suma una vez, sin repartir su gasto entre propiedades.'
const costHelp='Gasto de los anuncios seleccionados dividido entre sus contactos nuevos únicos del período. Si gastaste $20 y llegaron 10 contactos, el promedio es $2; no significa que cada persona costó exactamente eso. Contactos: fecha de registro en Ecuador. Gasto: fechas de Meta.'
const inputStyle='min-w-0 rounded-lg border border-[#ded8cc] bg-white px-3 py-2 text-sm text-[#29251e] focus:outline-2 focus:outline-[#8a754c]'
const metricOrder:VisibleMetric[]=['hot','warm','cold','unevaluated']
const interestLabel={frio:'Frío',tibio:'Tibio',caliente:'Caliente',sin_clasificar:'Sin clasificar'}
function money(value:number|null,currency:string|null){
 if(value==null || !currency)return 'No disponible'
 try{return new Intl.NumberFormat('es-EC',{style:'currency',currency,maximumFractionDigits:2}).format(value)}catch{return 'No disponible'}
}
function date(value?:string|null){return value && Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'short'}):'Sin registro verificable'}
function cost(summary:PanelSummary){return summary.spend==null?'No disponible':!summary.groups.contacts.length?'Sin contactos nuevos':money(summary.cost,summary.currency)}
type Selection={scope:string;metric:VisibleMetric;title:string}

export function AdvertisingMetricsPanel({report,initialFilters={campaign:'',ad:'',search:''}}:{report:MarketingFunnelReport;initialFilters?:PanelFilters}) {
 const router=useRouter(),[pending,startTransition]=useTransition()
 const [filters,setFilters]=useState(initialFilters),[from,setFrom]=useState(report.period.from),[to,setTo]=useState(report.period.to)
 const [expanded,setExpanded]=useState<Set<string>>(new Set()),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10)
 const [selection,setSelection]=useState<Selection|null>(null)
 const [roster,setRoster]=useState<FunnelLeadDetailRow[]>([]),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState(false)
 const [detailLead,setDetailLead]=useState<string|null>(null),[advisors,setAdvisors]=useState<TeamProfile[]>([])
 const [adDetail,setAdDetail]=useState<string|null>(null),[identify,setIdentify]=useState(false)
 const model=useMemo(()=>buildAdvertisingPanel(report,filters),[report,filters])
 const summaries=new Map<string,PanelSummary>([['total',model.summary]])
 for(const row of model.rows){summaries.set('campaign:'+row.key,row.summary);for(const ad of row.ads)summaries.set('ad:'+ad.key,ad.summary)}
 const selectedIds=selection?summaries.get(selection.scope)?.groups[selection.metric] || []:[]
 const selectedKey=JSON.stringify(selectedIds)
 const pages=Math.max(1,Math.ceil(model.rows.length/pageSize)),currentPage=Math.min(page,pages)
 const visible=model.rows.slice((currentPage-1)*pageSize,currentPage*pageSize)
 const ad=model.ads.find(row=>row.adId===adDetail)
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')router.refresh()};const timer=setInterval(refresh,60_000);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}},[router])
 useEffect(()=>{
   if(!selection)return
   let active=true
   async function load(){
     setLoading(true);setLoadError(false);setRoster([])
     const rows:FunnelLeadDetailRow[]=[],ids=JSON.parse(selectedKey) as string[]
     try{for(let i=0;i<ids.length;i+=200){const result=await listFunnelLeadDetails({tenantId:report.tenantId,projectId:report.projectId,leadIds:ids.slice(i,i+200)});if(!result.ok)throw Error('DETAIL_UNAVAILABLE');rows.push(...result.rows)}if(active){setRoster(rows);setLoadError(ids.some(id=>!rows.some(row=>row.id===id)))}}
     catch{if(active)setLoadError(true)}finally{if(active)setLoading(false)}
   }
   void load();return()=>{active=false}
 },[selectedKey,selection?.scope,selection?.metric,report.tenantId,report.projectId]) // eslint-disable-line react-hooks/exhaustive-deps
 function updateFilters(next:PanelFilters){setFilters(next);setPage(1);setSelection(null);setAdDetail(null)}
 function select(scope:string,key:VisibleMetric,title:string){setSelection({scope,metric:key,title})}
 function number(summary:PanelSummary,key:VisibleMetric,scope:string,title:string){
   const ids=summary.groups[key],text=String(ids.length)
   const unknownKey:VisibleMetric|null=['hot','warm','cold'].includes(key)?'unevaluated':null,unknown=unknownKey?summary.groups[unknownKey].length:0
   return <span className="inline-flex flex-col items-start text-left">
     <button type="button" className="rounded px-1 py-1 font-semibold text-[#796139] underline decoration-[#c8b998] underline-offset-4 hover:bg-[#eee7dc]" aria-label={`${labels[key]} de ${title}: ${ids.length}`} onClick={()=>select(scope,key,title)}>{text}</button>
     {unknownKey && unknown>0?<button type="button" className="rounded px-1 text-xs font-normal text-[#766c5c] underline" aria-label={`${unknown} por comprobar de ${title}: ${labels[unknownKey]}`} onClick={()=>select(scope,unknownKey,title)}>{unknown} por comprobar</button>:null}
   </span>
 }
 function cells(summary:PanelSummary,scope:string,title:string){return <>
   <td className="px-3 py-3 tabular-nums">{money(summary.spend,summary.currency)}{summary.stale?<span title="Dato guardado, pendiente de actualizar"> *</span>:null}</td>
   <td className="px-3 py-3 text-right tabular-nums">{number(summary,'contacts',scope,title)}</td>
   <td className="px-3 py-3 tabular-nums">{cost(summary)}</td>
   {metricOrder.map(key=><td key={key} className="px-3 py-3 text-right tabular-nums">{number(summary,key,scope,title)}</td>)}
 </>}
 const cards:Array<{label:string;metric?:VisibleMetric;value?:string;help:string}>=[
  {label:'Gasto publicitario',value:money(model.summary.spend,model.summary.currency),help:expenseHelp},
  {label:'Contactos nuevos de anuncios',metric:'contacts',help:descriptions.contacts},
  {label:'Costo promedio por contacto',value:cost(model.summary),help:costHelp},
  {label:'Contactos calientes',metric:'hot',help:descriptions.hot},
 ]
 const displayedIds=selectedIds
 const comparable=model.rows.flatMap(row=>row.ads).filter(row=>row.summary.cost!=null && row.summary.currency===model.summary.currency).sort((a,b)=>a.summary.cost!-b.summary.cost!)
 return <div className="min-w-0 space-y-4 text-[#29251e]">
   <section aria-label="Indicadores publicitarios" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
     {cards.map(card=><article key={card.label} className="min-w-0 rounded-xl border border-[#e9e1d5] bg-[#faf8f4] p-3">
       <h2 className="text-xs font-medium leading-5 text-[#766c5c]">{card.label}<MetricHelp label={card.label} description={card.help} /></h2>
       <div className="mt-2 break-words text-xl font-semibold tabular-nums">{card.metric?number(model.summary,card.metric,'total','todos los resultados'):card.value}</div>
     </article>)}
   </section>
   <form aria-label="Filtros publicitarios" className="grid grid-cols-2 gap-3 rounded-xl border border-[#e9e1d5] bg-white p-3 lg:grid-cols-6" onSubmit={event=>{event.preventDefault();if(!from || !to || from>to)return;const query=new URLSearchParams({from,to,projectId:report.projectId,campaign:filters.campaign,ad:filters.ad,q:filters.search});setSelection(null);startTransition(()=>router.push('/inmobiliaria/marketing/metricas?'+query))}}>
     <label className="flex min-w-0 flex-col gap-1 text-xs">Desde<input aria-label="Desde" type="date" required value={from} max={to} onChange={e=>setFrom(e.target.value)} className={inputStyle} /></label>
     <label className="flex min-w-0 flex-col gap-1 text-xs">Hasta<input aria-label="Hasta" type="date" required value={to} min={from} onChange={e=>setTo(e.target.value)} className={inputStyle} /></label>
     <label className="flex min-w-0 flex-col gap-1 text-xs">Campaña<select value={filters.campaign} onChange={e=>updateFilters({...filters,campaign:e.target.value,ad:''})} className={inputStyle}><option value="">Todas las campañas</option>{model.campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
     <label className="flex min-w-0 flex-col gap-1 text-xs">Anuncio<select value={filters.ad} onChange={e=>updateFilters({...filters,ad:e.target.value})} className={inputStyle}><option value="">Todos los anuncios</option>{model.adOptions.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
     <label className="flex min-w-0 flex-col gap-1 text-xs">Buscar por nombre<span className="relative"><Search aria-hidden className="absolute left-2 top-2.5 h-4 w-4 text-[#887b65]" /><input type="search" value={filters.search} onChange={e=>updateFilters({...filters,search:e.target.value})} placeholder="Campaña o anuncio" className={`${inputStyle} w-full pl-8`} /></span></label>
     <div className="flex items-end gap-2"><button type="submit" disabled={pending} className="rounded-lg bg-[#796139] px-3 py-2 text-sm text-white disabled:opacity-50">{pending?'Consultando…':'Aplicar fechas'}</button><button type="button" onClick={()=>updateFilters({campaign:'',ad:'',search:''})} className="py-2 text-xs underline">Limpiar</button></div>
   </form>
   <div className="flex flex-wrap justify-between gap-2 text-xs text-[#766c5c]"><p>Datos del {report.period.from} al {report.period.to}. El interés corresponde al estado actual del CRM.</p><p>Última sincronización registrada: {date(report.attention?.lastMessageSyncAt)}</p></div>
   <details className="rounded-lg border border-[#e9e1d5] bg-[#faf8f4] px-3 py-2 text-xs">
     <summary className="cursor-pointer">Fuentes y fechas del informe</summary>
     <div className="mt-2 space-y-1 leading-5">
       <p>Consulta del CRM: {date(report.attention?.asOf)}.</p>
       <p>Consulta del gasto: {date(report.adsInsightsCoverage.insightsFetchedAt)}. Meta usa {report.adsAccountTimezone || 'una zona horaria no disponible'}; contactos: America/Guayaquil.</p>
       <p>{model.summary.groups.unevaluated.length} contactos sin clasificar. Los contactos sin anuncio identificado se conservan en el CRM y quedan fuera de este panel.</p>
       <p>Se consulta automáticamente cada minuto al mantener esta pantalla visible. Esto no demuestra sincronización completa con Kommo.</p>
       {model.summary.stale?<p>* Parte del gasto procede de datos guardados pendientes de actualizar.</p>:null}
       {model.conflicts.length?<p>{model.conflicts.length} identidades con adquisición ambigua no se atribuyen de nuevo; requieren revisión.</p>:null}
       {[...new Set([...(report.limitations || []),])].map(note=><p key={note}>{note}</p>)}
     </div>
   </details>
   <section aria-label="Resultados publicitarios" className="min-w-0 overflow-hidden rounded-xl border border-[#e9e1d5] bg-white">
     <div role="region" aria-label="Tabla de campañas y anuncios" tabIndex={0} className="overflow-x-auto focus-visible:outline-2">
       <table className="w-full min-w-[900px] text-left text-xs">
         <caption className="sr-only">Campañas y anuncios. Totales de todos los resultados filtrados, independientemente de la página.</caption>
         <thead className="border-b border-[#e2d7c6] bg-[#f4f0e9] text-[#655a49]"><tr>
           <th scope="col" className="min-w-64 px-4 py-3">Campaña / anuncio</th>
           <th scope="col" className="px-3 py-3">Gasto</th>
           <th scope="col" className="px-3 py-3">Contactos nuevos</th>
           <th scope="col" className="min-w-36 px-3 py-3">Costo promedio por contacto</th>
           {metricOrder.map(key=><th scope="col" key={key} className="px-3 py-3">{labels[key]}</th>)}
         </tr></thead>
         <tbody>{visible.map(campaign=><Fragment key={campaign.key}>
           <tr className="border-b border-[#e9e1d5] bg-[#faf8f4] font-medium" data-campaign={campaign.key}>
             <th scope="row" className="px-3 py-3"><button type="button" className="flex items-center gap-2 text-left" aria-expanded={expanded.has(campaign.key)} onClick={()=>setExpanded(previous=>{const next=new Set(previous);if(next.has(campaign.key))next.delete(campaign.key);else next.add(campaign.key);return next})}>{expanded.has(campaign.key)?<ChevronDown className="h-4 w-4 shrink-0" />:<ChevronRight className="h-4 w-4 shrink-0" />}<span>{campaign.name}<span className="block text-[10px] font-normal text-[#887b65]">{campaign.ads.length} anuncios</span></span></button></th>
             {cells(campaign.summary,'campaign:'+campaign.key,campaign.name)}
           </tr>
           {expanded.has(campaign.key)?campaign.ads.map(item=><tr key={item.key} data-ad={item.key} className="border-b border-[#f0ebe4] hover:bg-[#fdfbf7]"><th scope="row" className="py-3 pl-9 pr-3 font-normal"><button type="button" className="text-left underline decoration-[#c8b998] underline-offset-4" onClick={()=>{setAdDetail(item.key);setIdentify(false)}} aria-label={`Detalle del anuncio ${item.name}`}>{item.name}</button></th>{cells(item.summary,'ad:'+item.key,item.name)}</tr>):null}
         </Fragment>)}{!model.rows.length?<tr><td colSpan={8} className="p-8 text-center text-[#887b65]">{report.adsCatalog?.status==='failed'?'No hay resultados disponibles para estos filtros; la consulta publicitaria está incompleta.':'No hay campañas o anuncios para estos filtros.'}</td></tr>:null}</tbody>
         <tfoot className="border-t-2 border-[#c8b998] bg-[#f4f0e9] font-semibold"><tr><th scope="row" className="px-4 py-4">Total de resultados filtrados</th>{cells(model.summary,'total','todos los resultados')}</tr></tfoot>
       </table>
     </div>
     <nav aria-label="Paginación de campañas" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"><label>Campañas por página <select aria-label="Campañas por página" className="rounded border p-1" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1)}}>{[5,10,20].map(n=><option key={n}>{n}</option>)}</select></label><span>{model.rows.length} campañas · Página {currentPage} de {pages}</span><div className="flex gap-3"><button type="button" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)} className="disabled:opacity-40">Anterior</button><button type="button" disabled={currentPage>=pages} onClick={()=>setPage(currentPage+1)} className="disabled:opacity-40">Siguiente</button></div></nav>
   </section>
   <p aria-label="Conclusión de los resultados filtrados" className="px-1 text-sm leading-6 text-[#655a49]">{!model.summary.groups.contacts.length?'No hay contactos nuevos atribuidos en estos resultados.':`${model.summary.groups.contacts.length} contactos nuevos: ${model.summary.groups.hot.length} calientes, ${model.summary.groups.warm.length} tibios, ${model.summary.groups.cold.length} fríos y ${model.summary.groups.unevaluated.length} sin clasificar.`} {comparable.length>1?`Entre los anuncios con gasto y contactos, el costo promedio va de ${money(comparable[0].summary.cost,model.summary.currency)} en ${comparable[0].name} a ${money(comparable.at(-1)!.summary.cost,model.summary.currency)} en ${comparable.at(-1)!.name}.`:''} </p>
   <ModalOverlay isOpen={!!selection && !detailLead} onOpenChange={open=>{if(!open)setSelection(null)}} isDismissable className="fixed inset-0 z-50 flex justify-end bg-black/30">
     <Modal className="h-full w-full max-w-xl bg-white shadow-xl"><Dialog aria-label="Contactos del indicador" className="flex h-full flex-col outline-none">
       <header className="flex items-start justify-between border-b p-4"><div><h2 className="font-semibold">{selection?labels[selection.metric]:''} · {selection?.title}</h2><p className="mt-1 text-xs text-[#766c5c]">{displayedIds.length} de {selectedIds.length} personas · {report.period.from} a {report.period.to}</p></div><button type="button" aria-label="Cerrar contactos" onClick={()=>setSelection(null)} className="p-2"><X className="h-5 w-5" /></button></header>
       <div className="flex-1 space-y-3 overflow-y-auto p-4">{loading?<p role="status">Consultando fichas…</p>:null}{loadError?<p role="alert">No se pudieron completar todas las fichas. Se conservan los IDs del indicador; no se sustituyen por otras personas.</p>:null}{!displayedIds.length?<p>No hay personas en esta selección.</p>:null}
         {displayedIds.map(id=>{const person=model.people.get(id),lead=roster.find(row=>row.id===id),interest=report.interestByLead?.[id];return <article key={id} className="rounded-xl border border-[#e9e1d5] p-3" data-person={id}>
           <h3 className="font-semibold">{lead?.name || person?.name || 'Nombre no disponible'}</h3>
           <p className="mt-1 text-sm">{interestLabel[interest?.bucket || 'sin_clasificar']}</p>{interest?.evaluatedAt?<p className="mt-1 text-xs text-[#766c5c]">Actualizado: {date(interest.evaluatedAt)}</p>:null}
           <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#796139]"><button type="button" className="underline" onClick={async()=>{try{setAdvisors(await listTeamProfilesAction())}catch{setAdvisors([])}setDetailLead(id)}}>Abrir ficha</button>{person?.kommoUrl?<a href={person.kommoUrl} target="_blank" rel="noopener noreferrer" className="underline">Abrir Kommo</a>:<span>Enlace Kommo no disponible</span>}</div>
           <details className="mt-2 text-xs text-[#887b65]"><summary>Identificadores y evidencia</summary><p>CRM: {id} · Ficha Kommo: {person?.kommoId || 'No disponible'} · Contacto Kommo: {person?.contactId || 'No disponible'}</p></details>
         </article>})}
       </div>
     </Dialog></Modal>
   </ModalOverlay>
   <LeadDetailModal leadId={detailLead} isOpen={!!detailLead} onClose={()=>setDetailLead(null)} onUpdated={()=>router.refresh()} tenantId={report.tenantId} advisors={advisors} />
   <ModalOverlay isOpen={!!ad && !identify} onOpenChange={open=>{if(!open)setAdDetail(null)}} isDismissable className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><Modal className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"><Dialog aria-label="Detalle del anuncio" className="outline-none"><div className="flex justify-between"><h2 className="font-semibold">{ad?.adName || 'Anuncio sin nombre'}</h2><button type="button" aria-label="Cerrar anuncio" onClick={()=>setAdDetail(null)}><X /></button></div><p className="mt-3">Propiedad: {ad?.promotedUnit.label || 'Propiedad sin identificar'}</p><p className="mt-2 text-xs">{ad?.metaResultLabel || 'Resultados de Meta'}: {ad?.metaReportedResults ?? 'No disponible'}. Estos resultados no son contactos registrados del CRM.</p><p className="mt-2 text-xs">Anuncio: {ad?.adId} · Campaña: {ad?.campaignId || 'Pendiente de identificar'}</p><p className="mt-2 text-xs">Gasto consultado: {date(ad?.spendFetchedAt)}{ad?.spendStale?' · Dato guardado pendiente de actualizar':''}</p><button type="button" className="mt-4 rounded border px-3 py-2 text-sm" onClick={()=>setIdentify(true)}>{ad?.promotedUnit.kind==='none'?'Identificar propiedad':'Corregir propiedad'}</button></Dialog></Modal></ModalOverlay>
   {ad && identify?<PropertyIdentificationDialog adId={ad.adId!} property={ad.promotedUnit} tenantId={report.tenantId} projectId={report.projectId} onClose={()=>setIdentify(false)} onSaved={()=>{setIdentify(false);router.refresh()}} />:null}
 </div>
}
