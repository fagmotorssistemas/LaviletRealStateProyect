'use client'

import { useState } from 'react'
import { Check, Phone } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { completeUrgentVisitCoordinationAction } from '@/app/inmobiliaria/agenda/actions'
import { ecuadorLocalToIso, ecuadorYmd } from '@/lib/inmobiliaria/agendaTime'

export function UrgentVisitAgreement({ requestId, onCancel, onSaved }: {
  requestId: string; onCancel: () => void; onSaved: () => Promise<void>
}) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [notes, setNotes] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true)
    try {
      const startTime = ecuadorLocalToIso(date, time)
      if (!startTime) throw new Error('Indica la fecha y hora acordadas con el cliente.')
      await completeUrgentVisitCoordinationAction({ requestId, startTime, endTime: new Date(Date.parse(startTime) + 3_600_000).toISOString(), callNotes: notes, agreedByPhone: agreed })
      await onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo registrar el acuerdo. Revisa la disponibilidad.') }
    finally { setSaving(false) }
  }
  return <form onSubmit={event => void save(event)} className="space-y-4">
    <p className="flex gap-2 rounded-xl bg-[#f6f8f1] p-4 text-sm leading-relaxed text-[#526247]"><Phone size={18} className="mt-0.5 shrink-0" />Registra la visita después de hablar con el cliente y acordar el horario. Se comprobará la agenda antes de guardar.</p>
    <fieldset disabled={saving} className="space-y-4">
      <div className="grid grid-cols-2 gap-3"><Input id="call-visit-date" label="Fecha acordada" type="date" min={ecuadorYmd()} required value={date} onChange={event => setDate(event.target.value)} /><Input id="call-visit-time" label="Hora de Ecuador" type="time" required value={time} onChange={event => setTime(event.target.value)} /></div>
      <p className="text-xs text-[#858a7c]">Duración de la visita: 60 minutos.</p>
      <Textarea id="call-visit-notes" label="Resumen de la llamada" placeholder="Indica qué acordaron y cualquier detalle útil para recibir al cliente." required minLength={10} maxLength={1500} value={notes} onChange={event => setNotes(event.target.value)} />
      <label className="flex items-start gap-2 text-sm leading-relaxed text-[#535c48]"><input type="checkbox" required checked={agreed} onChange={event => setAgreed(event.target.checked)} className="mt-1 accent-[#526247]" />Confirmo que acordé este horario con el cliente por teléfono.</label>
    </fieldset>
    <p className="text-xs leading-relaxed text-stone-500">El bot permanecerá pausado. Este registro no enviará un mensaje automático al cliente.</p>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Volver</Button><Button type="submit" disabled={saving || !agreed} className="gap-2 tracking-normal"><Check size={15} />{saving ? 'Guardando acuerdo…' : 'Registrar visita acordada'}</Button></div>
  </form>
}
