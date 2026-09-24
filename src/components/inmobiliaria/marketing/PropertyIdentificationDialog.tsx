'use client'

import { useEffect, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { UnitNumberSearchInput } from '@/components/inmobiliaria/shared/UnitNumberSearchInput'
import { assignPromotedUnitAction, listPromotedPropertyHistoryAction } from '@/app/inmobiliaria/marketing/metricas/actions'
import type { AdPromotedUnitSummary, PropertyTarget } from '@/lib/meta/adPropertyIdentification'

type Choice = PropertyTarget & {label: string}
type HistoryResult = Awaited<ReturnType<typeof listPromotedPropertyHistoryAction>>

export function PropertyIdentificationDialog({ adId, property, tenantId, projectId, onClose, onSaved }: {
  adId: string; property: AdPromotedUnitSummary; tenantId: string; projectId: string
  onClose: () => void; onSaved: () => void
}) {
  const [choices,setChoices] = useState<Choice[]>(()=>property.links.map(l=>({unitId:l.unitId,externalLabel:l.externalLabel,label:l.unitLabel || l.externalLabel || 'Propiedad'})))
  const [expectedIds] = useState(()=>property.evidence==='ad_link'?[]:property.links.map(l=>l.id).filter(Boolean))
  const [externalName,setExternalName] = useState('')
  const [note,setNote] = useState('')
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState<string|null>(null)
  const [history,setHistory] = useState<HistoryResult|null>(null)
  useEffect(()=>{
    let active = true
    listPromotedPropertyHistoryAction({adId,tenantId,projectId}).then(result=>{if(active) setHistory(result)}).catch(()=>{if(active) setHistory({ok:false,error:'No se pudo consultar el historial'})})
    return ()=>{active=false}
  },[adId,tenantId,projectId])

  function add(choice: Choice) {
    if (choices.length>=20) {setError('Puede identificar hasta 20 propiedades en un anuncio.');return}
    if (choices.some(c=>choice.unitId ? c.unitId===choice.unitId : c.externalLabel?.toLowerCase()===choice.externalLabel?.toLowerCase())) return
    setChoices(prev=>[...prev,choice]);setError(null)
  }
  async function save() {
    setSaving(true);setError(null)
    try {
      const result = await assignPromotedUnitAction({adId,tenantId,projectId,
        targets:choices.map(({unitId,externalLabel})=>({unitId,externalLabel})),
        expectedIds,note})
      if (!result.ok) {setError(result.error);return}
      onSaved()
    } catch {setError('No se pudo guardar. Vuelva a intentarlo.')} finally {setSaving(false)}
  }
  return <ModalOverlay isOpen onOpenChange={open=>{if(!open&&!saving)onClose()}} isDismissable={!saving} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
    <Modal className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
      <Dialog className="outline-none">
        <Heading slot="title" className="text-lg font-semibold">{property.kind==='none'?'Identificar propiedad':'Corregir propiedad'}</Heading>
        <p className="mt-2 text-sm text-[#6b645c]">Anuncio {adId}. Identifique lo que anuncia, no las propiedades que el contacto consultó después.</p>
        <fieldset disabled={saving} className="mt-4 space-y-4 disabled:opacity-60">
          <legend className="text-sm font-semibold">Propiedades anunciadas</legend>
          <ul className="space-y-2">
            {choices.map((c,i)=><li key={c.unitId || c.externalLabel} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
              <span>{c.label}{c.externalLabel?' · Propiedad externa':''}</span>
              <button type="button" onClick={()=>setChoices(prev=>prev.filter((_,index)=>index!==i))} className="min-h-9 px-2 underline" aria-label={`Quitar ${c.label}`}>Quitar</button>
            </li>)}
          </ul>
          <div>
            <p className="mb-1 text-sm">Añadir una unidad del inventario de este proyecto</p>
            <UnitNumberSearchInput tenantId={tenantId} projectId={projectId} excludeIds={choices.flatMap(c=>c.unitId?[c.unitId]:[])} autoFocus={false}
              onSelect={unit=>add({unitId:unit.id,externalLabel:null,label:`${unit.category || 'Unidad'} ${unit.unit_number}`})} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Nombre de propiedad externa
              <input value={externalName} onChange={e=>setExternalName(e.target.value)} maxLength={160} placeholder="Nombre confirmado por el responsable" className="min-w-0 rounded-lg border p-2" />
            </label>
            <button type="button" disabled={!externalName.trim()} onClick={()=>{add({unitId:null,externalLabel:externalName.trim(),label:externalName.trim()});setExternalName('')}} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Añadir externa</button>
          </div>
          <label className="flex flex-col gap-1 text-sm">Cómo confirmó la propiedad o motivo de la corrección
            <textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} rows={2} className="rounded-lg border p-2" />
          </label>
        </fieldset>
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed">Guardar reemplaza la identificación anterior y conserva su historial. Al volver a consultar fechas pasadas se usará la identificación actual: cambia la etiqueta de propiedad, pero no las campañas, el gasto, los contactos ni el costo promedio. Si hay varias propiedades, el anuncio se cuenta una sola vez y su gasto no se reparte.</p>
        {error?<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>:null}
        <div className="mt-4 flex gap-3">
          <Button isDisabled={saving || !choices.length || !note.trim()} onPress={save} className="min-h-10 rounded-lg bg-[#2B1A18] px-4 text-white disabled:opacity-40">{saving?'Guardando…':'Guardar identificación'}</Button>
          <Button isDisabled={saving} onPress={onClose} className="min-h-10 rounded-lg border px-3">Cerrar</Button>
        </div>
        <details className="mt-4 border-t pt-3 text-sm">
          <summary className="cursor-pointer font-semibold">Historial de identificaciones (últimos 100 vínculos)</summary>
          {!history?<p>Cargando historial…</p>:history.ok?<ul className="mt-2 space-y-2">{history.rows.length?history.rows.map(row=><li key={row.id} className="rounded-lg border p-2">
            <p>{row.unitLabel || row.externalLabel}{row.externalLabel?' · Propiedad externa':''} · {row.supersededAt?'Anterior':'Vigente'}</p>
            <p className="text-xs">{new Date(row.assignedAt).toLocaleString('es-EC',{timeZone:'America/Guayaquil'})} · {row.assignedBy?'Usuario autorizado':'Registro administrativo'}</p>
            {row.note?<p className="mt-1 text-xs">{row.note}</p>:null}
          </li>):<li>Sin confirmaciones guardadas.</li>}</ul>:<p>{history.error}</p>}
        </details>
      </Dialog>
    </Modal>
  </ModalOverlay>
}
