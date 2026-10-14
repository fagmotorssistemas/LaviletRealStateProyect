'use client'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAdvisorNotifications } from '@/contexts/AdvisorNotificationsContext'
import { markAdvisorNotificationRead } from '@/services/advisorNotifications.service'
import { nextUrgentReservation } from '@/lib/inmobiliaria/urgentReservationNotifications'
import { kommoLeadUrl } from '@/lib/inmobiliaria/visitPresentation'
import type { AdvisorNotification } from '@/types/inmobiliaria'

function ReservationDialog({ item, onAcknowledged }: { item: AdvisorNotification; onAcknowledged: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { supabase, user } = useAuth()
  const { reload } = useAdvisorNotifications()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  const id = Number(item.lead?.kommo_id || item.metadata.kommo_id)
  const link = kommoLeadUrl(Number.isSafeInteger(id) && id > 0 ? id : null)
  const acknowledge = async () => {
    if (!user || saving) return
    setSaving(true); setError('')
    try {
      await markAdvisorNotificationRead(supabase, user.id, item.id)
      onAcknowledged(item.id)
      await reload()
    } catch { setError('No se pudo guardar la lectura. Vuelva a intentarlo; la alerta sigue pendiente.') }
    finally { setSaving(false) }
  }
  return <dialog ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="urgent-reservation-title" aria-describedby="urgent-reservation-body"
    onCancel={event => event.preventDefault()}
    className="fixed inset-0 m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl border-2 border-amber-500 bg-white p-0 text-stone-800 shadow-2xl backdrop:bg-stone-950/60">
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-5"><p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-widest text-amber-800 uppercase"><AlertTriangle size={18} />Atención urgente</p>
      <h2 id="urgent-reservation-title" className="text-xl font-semibold">{item.kind === 'reservation_confirmed' ? 'Se registró una reserva' : 'Un cliente quiere reservar'}</h2></div>
    <div className="space-y-4 p-6"><p id="urgent-reservation-body" className="leading-relaxed">{item.body}</p>
      {item.kind === 'reservation_requested' && <p className="text-sm text-stone-600">Es una solicitud pendiente de atención. Revise el caso y contacte al cliente para gestionar la reserva.</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-3">{link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-[#344a39] px-4 py-3 text-sm font-semibold text-white">Abrir lead en Kommo<ExternalLink size={15} /></a>}
        <button type="button" autoFocus disabled={saving} onClick={() => { void acknowledge() }} className="rounded-lg border border-stone-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">{saving ? 'Guardando…' : 'Entendido'}</button></div>
      <p className="text-xs text-stone-500">Entendido guarda la lectura de esta alerta; no confirma un pago ni modifica la reserva.</p>
    </div>
  </dialog>
}
export function UrgentReservationAlert() {
  const { user } = useAuth()
  const { items, ready } = useAdvisorNotifications()
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set())
  const item = ready && user ? nextUrgentReservation(items, user.id, acknowledged) : null
  return item ? <ReservationDialog key={item.id} item={item} onAcknowledged={id => setAcknowledged(previous => new Set([...previous, id]))} /> : null
}
