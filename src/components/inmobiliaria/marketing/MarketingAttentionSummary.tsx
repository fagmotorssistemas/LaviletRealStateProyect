'use client'

import { useState } from 'react'
import { attentionLabels, summarizeAttention, type AttentionData, type AttentionKey, type AttentionPerson } from '@/services/marketingAttention.logic'
import { MetricHelp } from './AccessibleMetricHelp'

const definitions:Record<AttentionKey,string>={
  cold:'Frío significa interés bajo registrado actualmente; no implica una venta perdida.',warm:'Tibio significa interés medio registrado actualmente; orienta el seguimiento.',hot:'Caliente significa interés alto registrado actualmente; no garantiza una compra.',unclassified:'No hay una clasificación de interés reconocida. Conviene revisar la ficha antes de priorizarla.',
  responseRecorded:'Hay evidencia verificable de una respuesta enviada. No exige entrega ni lectura. Un borrador o lanzamiento de bot aceptado no cuenta.',responseAuthorUnknown:'Existe una respuesta registrada, pero el historial no permite identificar con seguridad si la envió el bot o un asesor.',
    noResponse:'Sin respuesta registrada',botOnly:'Respuesta registrada del bot',advisor:'Respuesta registrada de un asesor',
  teamPending:'Existe una derivación humana pendiente o el cliente escribió después y la atención pertenece al asesor. No equivale a no haber respondido nunca.',
  teamOverdue:'Hay atención humana pendiente y venció la fecha límite guardada por las reglas de atención. No se inventan plazos ni se presume pérdida de la venta.',
  clientPending:'En una conversación abierta y evaluable, el último mensaje enviado es del bot o del asesor y no hay respuesta posterior del cliente. No demuestra que haya perdido interés.',
  followupPending:'Tiene al menos un seguimiento activo de recuperación, seguimiento programado o tarea automática de seguimiento pendiente. Una persona cuenta una vez aunque tenga varias tareas.',
  followupOverdue:'Tiene al menos un seguimiento pendiente cuya fecha programada ya pasó. Las tareas sin fecha no se consideran vencidas por suposición.',
  appointmentRequested:'Tiene una cita actualmente solicitada o pendiente. No es una confirmación de asistencia.',appointmentConfirmed:'Tiene una cita con confirmación registrada; puede estar pendiente de realizarse.',appointmentDone:'Tiene una cita atendida, no futura y sin inasistencia registrada. No implica una compra.',
  purchased:'Tiene una compra registrada hasta la consulta o su estado es vendido. Cuenta personas, aunque una persona compre varias unidades.',discarded:'Tiene un estado explícito de descarte o pérdida. Los motivos se muestran solo cuando están registrados, nunca se deducen del silencio.',
  anyPending:'Unión de personas sin primera respuesta registrada, con atención del equipo pendiente o con seguimientos pendientes. Cada persona cuenta una sola vez; no suma categorías superpuestas.',
}
const dates=' Se analizan contactos nuevos del período seleccionado y su evolución hasta esta consulta; su estado puede cambiar al revisar fechas anteriores.'

export function MarketingAttentionSummary({people,onOpen,title='Atención y avance',data}:{people:AttentionPerson[];onOpen:(ids:string[],title:string)=>void;title?:string;data?:AttentionData}) {
  const [detailIds,setDetailIds]=useState<string[]|null>(null)
  const summary=summarizeAttention(people)
  const metric=(key:AttentionKey)=>summary.metrics[key]
  const countButton=(ids:string[],label:string,text:string)=><button type="button" disabled={!ids.length} onClick={()=>{setDetailIds(ids);onOpen(ids,label)}} className="rounded px-1 py-1 text-left font-semibold text-[#5b4a9a] underline disabled:text-[#6b645c] disabled:no-underline">{text}</button>
  const fraction=(key:AttentionKey)=>{const m=metric(key);return m.evaluated?`${m.ids.length} de ${m.evaluated}, ${m.percent} %`:'Sin información suficiente'}
  const unknownIds=people.filter(p=>!p.historyComplete).map(p=>p.leadId)
  const unknown=unknownIds.length
  const compact=(key:AttentionKey,label:string)=>metric(key).evaluated?countButton(metric(key).ids,label,`${metric(key).ids.length}`):<span className="text-sm">Sin información suficiente</span>
  const reasonGroups=new Map<string,string[]>()
  for(const p of [...new Map(people.map(p=>[p.leadId,p])).values()]) if(p.flags.discarded) for(const reason of p.reasons.length?p.reasons:['Sin motivo registrado']) reasonGroups.set(reason,[...(reasonGroups.get(reason)||[]),p.leadId])
  return <section aria-label={title} className="min-w-0 space-y-3 rounded-xl border border-[#ece6dc] bg-white p-4 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{title}<MetricHelp label={title} description={'Contactos nuevos únicos del período, sin repetir adquisiciones por otros anuncios.'+dates} /></h3><span className="text-xs text-[#6b645c]">{data?`Consultado ${new Date(data.asOf).toLocaleString('es-EC',{timeZone:'America/Guayaquil'})}`:''}</span></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div className="rounded-lg bg-[#faf8f5] p-3"><p className="text-xs text-[#6b645c]">Contactos nuevos<MetricHelp label="Contactos nuevos" description={dates} /></p><p className="mt-1 text-xl font-semibold">{countButton(summary.ids,'Contactos nuevos',`${summary.total}`)}</p></div>
      <div className="rounded-lg bg-[#faf8f5] p-3"><p className="text-xs text-[#6b645c]">Con alguna respuesta enviada<MetricHelp label="Con alguna respuesta enviada" description={definitions.responseRecorded+dates} /></p><p className="mt-1 text-xl font-semibold">{compact('responseRecorded','Con respuesta comprobada')}</p></div>
      <div className="rounded-lg bg-[#faf8f5] p-3"><p className="text-xs text-[#6b645c]">Respuesta pendiente comprobada<MetricHelp label="Esperan al equipo" description={definitions.teamPending+dates} /></p><p className="mt-1 text-xl font-semibold">{compact('teamPending','Esperan al equipo')}</p></div>
      <div className="rounded-lg bg-[#faf8f5] p-3"><p className="text-xs text-[#6b645c]">Sin ninguna respuesta comprobada<MetricHelp label="Sin ninguna respuesta" description={definitions.noResponse+dates} /></p><p className="mt-1 text-xl font-semibold">{compact('noResponse','Sin ninguna respuesta')}</p></div>
      <div className="rounded-lg bg-[#faf8f5] p-3"><p className="text-xs text-[#6b645c]">Historial incompleto<MetricHelp label="Historial incompleto" description={'Todavía no se verificó toda la conversación original. Puede haber respuestas comprobadas y faltar otras interacciones. No implica abandono ni un pendiente del asesor.'+dates} /></p><p className="mt-1 text-xl font-semibold">{countButton(unknownIds,'Historial incompleto',String(unknown))}</p></div>
    </div>
    <p className="text-xs text-[#6b645c]">Respuesta enviada: {metric('responseRecorded').evaluated?fraction('responseRecorded'):'sin información suficiente'}. Pendiente del equipo: {metric('teamPending').evaluated?fraction('teamPending'):'sin información suficiente'}. {unknown} historial(es) pendiente(s) de verificar. Los porcentajes usan solo personas evaluables; las categorías pueden superponerse. Entrantes: {data?.lastInboundSyncAt ? new Date(data.lastInboundSyncAt).toLocaleString('es-EC',{timeZone:'America/Guayaquil'}) : 'sin sincronización exitosa'} · Salientes: {data?.lastOutboundSyncAt ? new Date(data.lastOutboundSyncAt).toLocaleString('es-EC',{timeZone:'America/Guayaquil'}) : 'sin sincronización exitosa'}.</p>
    {data?.syncDelays?.map(sync=><p key={sync.direction} className="text-xs text-[#6b645c]">Retraso observado de {sync.direction==='incoming'?'entrantes':'salientes'}: {sync.medianSeconds==null?'sin muestra verificable':'mediana '+Math.round(sync.medianSeconds*10)/10+' segundos, '+sync.sample+' mensajes'}. Medido desde la fecha original hasta su almacenamiento; no demuestra que estén todos los mensajes.</p>)}
    {detailIds ? <div className="rounded-lg border border-[#ece6dc] bg-[#faf8f5] p-3" aria-label="Detalle de contactos seleccionados">
      <div className="mb-2 flex items-center justify-between gap-2"><h4 className="font-semibold">Personas seleccionadas</h4><button type="button" className="text-xs font-semibold text-[#5b4a9a] underline" onClick={()=>setDetailIds(null)}>Ocultar detalle</button></div>
      <ul className="space-y-2 text-xs">{people.filter(person=>detailIds.includes(person.leadId)).map(person=><li key={person.leadId} className="border-b border-[#ece6dc] pb-2 last:border-0">
        <div className="flex flex-wrap gap-x-3 gap-y-1"><span>{person.name || 'Nombre no disponible'} · CRM: {person.leadId.slice(0,8)}…</span>{person.kommoUrl ? <a href={person.kommoUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#5b4a9a] underline">Ficha comercial Kommo {person.kommoId}</a> : <span>Kommo: no disponible</span>}<span>Vínculo original pendiente de contrastar</span><span>{person.adId ? `Anuncio: ${person.adId}` : 'Origen publicitario: no identificado'}</span></div>
        {person.sourceUrl ? <a href={person.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block text-[#5b4a9a] underline">Ver origen publicitario</a> : null}
        <div className="mt-1">{person.responses.length ? person.responses.map(response=><span key={response.id} className="mr-2 inline-block">{response.author==='bot'?'Bot':response.author==='asesor'?'Asesor':'Autor no identificado'} · {response.type} · {response.at ? new Date(response.at).toLocaleString('es-EC',{timeZone:'America/Guayaquil'}) : 'fecha no disponible'} · {response.delivery}</span>) : <span>{person.flags.responseRecorded===null?'Historial incompleto':'Sin respuesta registrada'}</span>}</div>
      </li>)}</ul>
    </div> : null}
    <details><summary className="cursor-pointer py-2 font-semibold">Ver detalle</summary><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {(Object.keys(attentionLabels) as AttentionKey[]).map(key=><div key={key} className="rounded-lg bg-[#faf8f5] p-3">
        <p>{attentionLabels[key]}<MetricHelp label={attentionLabels[key]} description={definitions[key]+dates} /></p>
        {summary.total===0?<p>Sin contactos en este grupo</p>:countButton(metric(key).ids,attentionLabels[key],fraction(key))}
        {metric(key).unknown>0?<p className="text-xs">{countButton(people.filter(p=>p.flags[key]===null).map(p=>p.leadId),'Sin información suficiente: '+attentionLabels[key],String(metric(key).unknown))} sin información suficiente; {countButton(people.filter(p=>p.flags[key]!==null).map(p=>p.leadId),'Evaluables: '+attentionLabels[key],String(metric(key).evaluated))} de {summary.total} evaluables.</p>:null}
      </div>)}
      {([['bot','bot'],['advisor','asesor']] as const).map(([key,label])=><div key={key} className="rounded-lg bg-[#faf8f5] p-3">
        <p>Tiempo hasta la primera respuesta del {label}<MetricHelp label={`Tiempo hasta la primera respuesta del ${label}`} description={`Promedio de minutos transcurridos desde el primer mensaje entrante verificable hasta la primera respuesta enviada del ${label}. Se calcula solo para las personas con ambos momentos y un historial evaluable. No mide tiempo hábil ni mezcla bot con asesor.`+dates} /></p>
        {countButton(summary[key].ids,`Primera respuesta del ${label}`,summary[key].seconds==null?'Sin información suficiente':`${Math.round(summary[key].seconds/6)/10} min`)}
        <p className="text-xs">{summary[key].ids.length} de {summary.total} con ambos momentos verificables.</p>
      </div>)}
    </div></details>
    <div className="rounded-lg border p-3" aria-label="Conclusión verificable">
      <h4 className="font-semibold">Qué muestran estos contactos</h4>
      {summary.total===0?<p>No hay contactos nuevos en este grupo; no se calculan porcentajes.</p>:<>
        <p>Sin respuesta comprobada: {countButton(metric('noResponse').ids,attentionLabels.noResponse,fraction('noResponse'))}. Autor no identificado: {countButton(metric('responseAuthorUnknown').ids,attentionLabels.responseAuthorUnknown,fraction('responseAuthorUnknown'))}. Seguimientos vencidos: {countButton(metric('followupOverdue').ids,attentionLabels.followupOverdue,fraction('followupOverdue'))}.</p>
        <p>Personas con algún pendiente, sin duplicarlas: {countButton(metric('anyPending').ids,attentionLabels.anyPending,fraction('anyPending'))}. Si falta evidencia, se muestra como pendiente de verificar.</p>
        {metric('teamPending').ids.length>0?<p>Revisar la bandeja del equipo y las fichas con atención pendiente; atender primero las fechas límite vencidas registradas.</p>:null}
        {metric('followupOverdue').ids.length>0?<p>Revisar los seguimientos vencidos y registrar su resultado antes de programar otro contacto.</p>:null}
        {metric('noResponse').unknown>0?<p>Falta información para evaluar la primera respuesta de {countButton(people.filter(p=>p.flags.noResponse===null).map(p=>p.leadId),'Historial incompleto',String(metric('noResponse').unknown))} contactos. Completar el historial antes de concluir que no fueron atendidos.</p>:null}
      </>}
    </div>
    {reasonGroups.size>0?<div><h4 className="font-semibold">Motivos de descarte registrados</h4>{[...reasonGroups].map(([reason,ids])=><p key={reason}>{reason}: {countButton(ids,'Descarte: '+reason,`${ids.length} contactos`)}</p>)}</div>:null}
    {data?<div className="text-xs text-[#6b645c]">
      <p>Plazos de atención: {data.deadlines.length?data.deadlines.map(d=>d.minutes==null?'Sin plazo configurado':`${d.minutes} minutos hábiles (${d.timezone || 'zona no informada'})`).join('; '):'Sin información suficiente'}. Se utiliza la fecha límite guardada en cada ficha.</p>
      {data.limitations.map(note=><p key={note}>{note}</p>)}
    </div>:null}
  </section>
}
