'use client'

import { useState } from 'react'
import { Plus, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import type { VisitSchedulingOptions, VisitTimeSlot } from '@/types/inmobiliaria'
import { ecuadorLocalToIso, ecuadorYmd, isoToEcuadorParts } from '@/lib/inmobiliaria/agendaTime'
import { normalizeVisitOptions, type VisitProposalPreview } from '@/lib/inmobiliaria/visitProposalOptions'
import { prepareVisitOptionsAction, sendVisitOptionsAction } from '@/app/inmobiliaria/agenda/actions'

type EditableSlot = { date: string; time: string }
const editable = (slot: VisitTimeSlot): EditableSlot => isoToEcuadorParts(slot.start_time) ?? { date: '', time: '' }

export function VisitProposalComposer({ requestId, scheduling, onCancel, onSent }: {
  requestId: string
  scheduling: { options: VisitSchedulingOptions | null; loading: boolean; error: string; reload: (day?: string) => Promise<void> }
  onCancel: () => void
  onSent: () => Promise<void>
}) {
  const [edited, setEdited] = useState<EditableSlot[] | null>(null)
  const [preview, setPreview] = useState<VisitProposalPreview | null>(null)
  const [draftInput, setDraftInput] = useState('')
  const [working, setWorking] = useState<'preview' | 'send' | null>(null)
  const [error, setError] = useState('')
  const slots = edited ?? (scheduling.options?.slots ?? []).slice(0, 3).map(editable)
  const currentInput = JSON.stringify(slots)
  const currentPreview = preview && currentInput === draftInput ? preview : null
  const update = (index: number, patch: Partial<EditableSlot>) => {
    setEdited(slots.map((slot, i) => i === index ? { ...slot, ...patch } : slot))
    setError('')
  }
  const generate = async () => {
    setWorking('preview'); setError(''); setPreview(null)
    try {
      const selected = normalizeVisitOptions(slots.map(slot => {
        const start = ecuadorLocalToIso(slot.date, slot.time)
        return { start_time: start, end_time: start ? new Date(Date.parse(start) + 3_600_000).toISOString() : '' }
      }))
      const result = await prepareVisitOptionsAction({ requestId, options: selected })
      setPreview(result); setDraftInput(currentInput)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo preparar la propuesta.')
    } finally { setWorking(null) }
  }
  const send = async () => {
    if (!currentPreview) return
    setWorking('send'); setError('')
    try {
      await sendVisitOptionsAction(currentPreview)
      await onSent()
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'No se pudo enviar la propuesta.'
      setError(message); setPreview(null); toast.error(message)
      void scheduling.reload()
    } finally { setWorking(null) }
  }
  return <div className="space-y-5">
    <section aria-label="Opciones de horario para el cliente" className="rounded-2xl border border-[#dfe5d5] bg-[#f6f8f1] p-4">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="font-semibold text-[#48553b]">Proponga hasta tres horarios</h3>
          <p className="mt-1 text-xs leading-relaxed text-[#737e65]">Recomendaciones de la agenda del asesor. Puede cambiar o quitar cualquiera antes de enviar. Cada visita dura 60 minutos.</p></div>
        <button type="button" aria-label="Buscar otras recomendaciones" disabled={!!working || scheduling.loading} onClick={() => { setEdited(null); setPreview(null); void scheduling.reload() }} className="rounded-lg p-2 text-[#657751] hover:bg-white disabled:opacity-40"><RefreshCw size={16} className={scheduling.loading ? 'animate-spin' : ''} /></button>
      </div>
      {scheduling.loading && <p role="status" className="mt-3 text-xs text-[#737e65]">Consultando disponibilidad…</p>}
      {scheduling.error && <p role="alert" className="mt-3 text-sm text-amber-800">{scheduling.error}</p>}
      {!scheduling.loading && !slots.length && <p className="mt-3 text-sm text-[#737e65]">No encontramos recomendaciones. Puede indicar otro horario y comprobarlo antes de enviarlo.</p>}
      <div className="mt-4 space-y-3">{slots.map((slot, index) => <fieldset key={index} disabled={!!working} className="rounded-xl border border-[#e2e7d9] bg-white p-3">
        <legend className="px-1 text-xs font-semibold text-[#60704f]">Opción {index + 1}</legend>
        <div className="mb-2 flex justify-end"><button type="button" onClick={() => setEdited(slots.filter((_, i) => i !== index))} aria-label={`Quitar opción ${index + 1}`} className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button></div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-stone-500">Fecha<input aria-label={`Fecha de opción ${index + 1}`} type="date" min={ecuadorYmd()} value={slot.date} onChange={event => update(index, { date: event.target.value })} className="mt-1 block w-full rounded-lg border border-stone-200 px-2 py-2 text-sm text-stone-800" /></label>
          <label className="text-xs text-stone-500">Hora de Ecuador<input aria-label={`Hora de opción ${index + 1}`} type="time" step={900} value={slot.time} onChange={event => update(index, { time: event.target.value })} className="mt-1 block w-full rounded-lg border border-stone-200 px-2 py-2 text-sm text-stone-800" /></label>
        </div>
      </fieldset>)}</div>
      {slots.length < 3 && <button type="button" disabled={!!working} onClick={() => setEdited([...slots, { date: slots[0]?.date || ecuadorYmd(), time: '' }])} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#60704f]"><Plus size={14} />Agregar horario</button>}
    </section>
    <p className="text-xs leading-relaxed text-stone-500">Se comprobarán las citas y solicitudes pendientes antes del envío. El cliente podrá elegir una opción o indicar otro día y hora.</p>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    <Button type="button" variant="outline" className="w-full gap-2 tracking-normal" disabled={!!working || scheduling.loading || !slots.length} onClick={() => void generate()}><Sparkles size={15} />{working === 'preview' ? 'Comprobando y redactando…' : currentPreview ? 'Redactar otra variante' : 'Comprobar horarios y redactar mensaje'}</Button>
    {currentPreview && <section aria-label="Vista previa del mensaje" className="rounded-xl border border-[#dfe5d5] p-4"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#657751]">Mensaje que recibirá el cliente</h3><p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{currentPreview.message}</p></section>}
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="outline" disabled={!!working} onClick={onCancel}>Volver</Button>
      <Button type="button" disabled={!!working || !currentPreview} onClick={() => void send()} className="gap-2 tracking-normal"><Send size={14} />{working === 'send' ? 'Enviando propuesta…' : 'Enviar propuesta al cliente'}</Button></div>
  </div>
}
