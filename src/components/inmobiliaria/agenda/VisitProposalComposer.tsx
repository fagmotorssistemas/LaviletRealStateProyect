'use client'

import { useState } from 'react'
import { Pencil, Plus, Send, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import type { VisitSchedulingOptions, VisitTimeSlot } from '@/types/inmobiliaria'
import { ecuadorLocalToIso, ecuadorYmd, formatAgendaDateTime, isoToEcuadorParts } from '@/lib/inmobiliaria/agendaTime'
import { normalizeVisitOptions, type VisitProposalPreview } from '@/lib/inmobiliaria/visitProposalOptions'
import { prepareVisitOptionsAction, sendVisitOptionsAction } from '@/app/inmobiliaria/agenda/actions'
import { VisitRecommendations } from './VisitRecommendations'

type EditableSlot = { date: string; time: string }

export function VisitProposalComposer({ requestId, scheduling, onCancel, onSent }: {
  requestId: string
  scheduling: { options: VisitSchedulingOptions | null; loading: boolean; error: string; reload: (day?: string) => Promise<void> }
  onCancel: () => void
  onSent: () => Promise<void>
}) {
  const [slots, setSlots] = useState<VisitTimeSlot[]>([])
  const [manual, setManual] = useState<EditableSlot | null>(null)
  const [editingStart, setEditingStart] = useState<string | null>(null)
  const [preview, setPreview] = useState<VisitProposalPreview | null>(null)
  const [draftInput, setDraftInput] = useState('')
  const [working, setWorking] = useState<'preview' | 'send' | null>(null)
  const [error, setError] = useState('')
  const currentInput = JSON.stringify(slots)
  const currentPreview = preview && currentInput === draftInput ? preview : null
  const requested = scheduling.options?.requested
  const select = (slot: VisitTimeSlot) => {
    setError('')
    setSlots(current => current.some(item => item.start_time === slot.start_time)
      ? current.filter(item => item.start_time !== slot.start_time)
      : current.length < 3 ? [...current, slot] : current)
  }
  const edit = (slot?: VisitTimeSlot) => {
    setEditingStart(slot?.start_time ?? null)
    setManual(slot ? isoToEcuadorParts(slot.start_time) : { date: requested?.requested_date || ecuadorYmd(), time: '' })
    setError('')
  }
  const saveManual = () => {
    if (!manual) return
    try {
      const start = ecuadorLocalToIso(manual.date, manual.time)
      if (!start) throw new Error('Indica una fecha y hora válidas.')
      const option = { start_time: start, end_time: new Date(Date.parse(start) + 3_600_000).toISOString() }
      const next = editingStart ? slots.map(slot => slot.start_time === editingStart ? option : slot) : [...slots, option]
      setSlots(normalizeVisitOptions(next))
      setManual(null); setEditingStart(null); setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Revisa el horario seleccionado.') }
  }
  const generate = async () => {
    setWorking('preview'); setError(''); setPreview(null)
    try {
      const result = await prepareVisitOptionsAction({ requestId, options: normalizeVisitOptions(slots) })
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
  return <div className="space-y-4">
    {requested?.source_text && <div className="rounded-xl border border-[#eceee6] px-4 py-3"><p className="text-xs font-semibold text-[#7b8170]">Preferencia del cliente</p><p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-[#535c48]">{requested.source_text}</p></div>}
    <VisitRecommendations options={scheduling.options} loading={scheduling.loading} error={scheduling.error}
      disabled={!!working} selectedStart="" selectedStarts={slots.map(slot => slot.start_time)}
      onSelect={select} onReload={() => { setPreview(null); void scheduling.reload(manual?.date || undefined) }} />
    <section aria-label="Horarios elegidos" className="space-y-2">
      <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold text-[#60704f]">Para enviar al cliente <span className="font-normal">({slots.length}/3)</span></h3>
        {!manual && slots.length < 3 && <button type="button" disabled={!!working} onClick={() => edit()} className="inline-flex items-center gap-1 text-xs font-semibold text-[#60704f]"><Plus size={14} />Otro horario</button>}</div>
      {!slots.length && <p className="text-xs text-[#858a7c]">Elige las alternativas que deseas proponer.</p>}
      {slots.map((slot, index) => <div key={slot.start_time} className="flex items-center gap-2 rounded-lg border border-[#e3e6dc] px-3 py-2 text-sm text-[#48553b]">
        <span className="min-w-0 flex-1">{index + 1}. {formatAgendaDateTime(slot.start_time)}</span>
        <button type="button" disabled={!!working} onClick={() => edit(slot)} aria-label={`Editar horario ${index + 1}`} className="rounded p-1 text-[#7e896d] hover:bg-[#f6f8f1]"><Pencil size={14} /></button>
        <button type="button" disabled={!!working} onClick={() => { select(slot); if (editingStart === slot.start_time) setManual(null) }} aria-label={`Quitar horario ${index + 1}`} className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600"><X size={15} /></button>
      </div>)}
    </section>
    {manual && <fieldset disabled={!!working} className="rounded-xl border border-[#e3e6dc] bg-[#f8f9f5] p-3">
      <legend className="px-1 text-xs font-semibold text-[#60704f]">{editingStart ? 'Editar horario' : 'Agregar otro horario'}</legend>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-stone-500">Fecha<input aria-label="Fecha del horario manual" type="date" min={ecuadorYmd()} value={manual.date} onChange={event => setManual({ ...manual, date: event.target.value })} className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-2 py-2 text-sm text-stone-800" /></label>
        <label className="text-xs text-stone-500">Hora de Ecuador<input aria-label="Hora del horario manual" type="time" step={900} value={manual.time} onChange={event => setManual({ ...manual, time: event.target.value })} className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-2 py-2 text-sm text-stone-800" /></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-[#858a7c]">Duración: 60 minutos</span><div className="flex gap-3"><button type="button" onClick={() => setManual(null)} className="text-xs text-stone-500">Cancelar</button><button type="button" onClick={saveManual} className="text-xs font-semibold text-[#526247]">Guardar horario</button></div></div>
    </fieldset>}
    <p className="text-xs leading-relaxed text-stone-500">Comprobaremos la disponibilidad antes de enviar. El cliente podrá elegir una alternativa o indicar otra fecha.</p>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    <Button type="button" variant="outline" className="w-full gap-2 tracking-normal" disabled={!!working || scheduling.loading || !slots.length || !!manual} onClick={() => void generate()}><Sparkles size={15} />{working === 'preview' ? 'Comprobando y redactando…' : currentPreview ? 'Redactar otra variante' : 'Revisar propuesta'}</Button>
    {currentPreview && <section aria-label="Vista previa del mensaje" className="rounded-xl border border-[#dfe5d5] p-4"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#657751]">Mensaje que recibirá el cliente</h3><p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{currentPreview.message}</p></section>}
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="outline" disabled={!!working} onClick={onCancel}>Volver</Button>
      <Button type="button" disabled={!!working || !currentPreview || !!manual} onClick={() => void send()} className="gap-2 tracking-normal"><Send size={14} />{working === 'send' ? 'Enviando propuesta…' : 'Enviar propuesta al cliente'}</Button></div>
  </div>
}
