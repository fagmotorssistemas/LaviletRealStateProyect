'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { canAccessPath } from '@/lib/inmobiliaria/roleAccess'
import { reservationServiceError } from '@/lib/inmobiliaria/automationErrors'
import type { deliveryHealth } from '@/lib/integrations/automation/delivery-state'

type Health = Awaited<ReturnType<typeof deliveryHealth>>

export function AutomationDeliveryBanner() {
  const { profile } = useAuth()
  const allowed = canAccessPath(profile?.role, '/inmobiliaria/automatizacion', profile?.crm_paths)
  const admin = profile?.role === 'admin'
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<'sent' | 'not_sent'>('not_sent')
  const [providerMessageId, setProviderMessageId] = useState('')
  const [reviewReference, setReviewReference] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/integrations/delivery', { cache: 'no-store', signal })
      if (!response.ok) throw Error()
      const result = await response.json() as Health
      if (!signal?.aborted) { setHealth(result); setError('') }
    } catch { if (!signal?.aborted) setError('No se pudo actualizar el estado de los envíos.') }
  }, [])
  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    const check = () => { if (!document.hidden) void refresh(controller.signal) }
    check()
    const interval = window.setInterval(check, 60_000)
    window.addEventListener('focus', check)
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener('focus', check) }
  }, [allowed, refresh])
  async function update(action: string, id?: string, evidence?: Record<string, unknown>) {
    setBusy(true)
    try {
      const response = await fetch('/api/integrations/delivery', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id, ...evidence }) })
      const result = await response.json()
      if (!response.ok) throw Error(result.error || 'No se pudo guardar la revisión.')
      setHealth(result); setError(''); setReviewId(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la revisión.') }
    finally { setBusy(false) }
  }
  const transport = health?.transport
  const transportIssue = Boolean(transport?.error || transport?.missing.length || transport?.delayed.length)
  if (!allowed || (!error && !health?.blocked && !health?.incidentCount && !transportIssue)) return null
  const reason = health?.httpStatus === 402 ? 'Kommo rechazó las solicitudes con «Payment Required» (402). Revise la suscripción o consulte a soporte de Kommo.'
    : health?.httpStatus === 401 ? 'Kommo rechazó las credenciales (401). Un administrador debe revisar la conexión.'
      : 'Kommo rechazó el acceso (403). Un administrador debe revisar los permisos de la integración.'
  return <section role="status" aria-live="polite" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-stone-800">
    <div className="flex items-start gap-3">
      <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-700" />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">{health?.blocked ? 'Los envíos del bot están bloqueados por Kommo' : health?.incidentCount ? 'Hay respuestas que necesitan revisión' : transportIssue ? 'Hay avisos sobre la sincronización con Kommo' : 'No se pudo verificar el estado del bot'}</h2>
        {health?.blocked && <><p className="mt-1">{reason}</p><p className="mt-1">Los nuevos mensajes se conservan pendientes. Cambiar «Detener IA» o reiniciar al lead no elimina este bloqueo.</p></>}
        {!!health?.pendingMessages && health.blocked && <p className="mt-1">Mensajes pendientes: {health.pendingMessages}.</p>}
        {!!health?.incidentCount && <details className="mt-3">
          <summary className="cursor-pointer font-medium">Revisar {health.incidentCount} {health.incidentCount === 1 ? 'intento sin respuesta confirmada' : 'intentos sin respuesta confirmada'}</summary>
          <p className="mt-2 text-xs">Los fallos temporales de generación se reintentan de forma limitada. Si persisten, la consulta pasa al equipo. Revise los casos pendientes en Kommo; un envío de resultado desconocido nunca se repite sin comprobar el historial.</p>
          <ul className="mt-2 space-y-2">
            {health.incidents.map(item => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-amber-200 bg-white/60 px-3 py-2">
              {item.kommoId ? <a className="inline-flex items-center gap-1 underline" href={`https://lavilet.kommo.com/leads/detail/${item.kommoId}`} target="_blank" rel="noopener noreferrer">Lead #{item.kommoId}<ExternalLink size={12} /></a> : <span>Automatización</span>}
              <span className="text-xs">{item.reason === 'KOMMO_INBOUND_NOT_OBSERVED' ? 'Kommo registra un mensaje sin recepción aquí; revise el canal y atienda la consulta pendiente' : item.reason === 'SUPERSEDED_DELAYED_INBOUND' ? 'Mensaje recibido fuera de orden; revise que la conversación más reciente haya atendido su consulta' : item.delivery === 'rejected' ? 'Solicitud rechazada; mensaje no enviado' : item.delivery === 'not_sent' ? 'Mensaje no enviado; necesita atención' : item.delivery === 'generation_failed' ? 'Falló la generación de la respuesta; requiere atención' : 'Resultado del envío por comprobar'} · {reservationServiceError(item.reason) || item.reason}</span>
              {admin && item.canResolve && !health.blocked && <button type="button" disabled={busy} onClick={() => void update('incident_reviewed', item.id)} className="ml-auto text-xs font-medium underline disabled:opacity-50">Ya atendí esta conversación</button>}
              {admin && item.canReconcile && <button type="button" disabled={busy} onClick={() => {
                setReviewId(reviewId === item.id ? null : item.id); setOutcome('not_sent'); setProviderMessageId(''); setReviewReference(''); setReviewed(false)
              }} className="ml-auto text-xs font-medium underline disabled:opacity-50">Comprobar este envío</button>}
              {admin && item.canReconcile && reviewId === item.id && <form className="mt-2 w-full space-y-2 border-t border-amber-200 pt-3" onSubmit={event => {
                event.preventDefault()
                void update('reconcile_incident', item.id, { outcome, reviewed, reviewReference: reviewReference.trim(),
                  ...(outcome === 'sent' ? { providerMessageId: providerMessageId.trim() } : {}) })
              }}>
                <p className="text-xs">Revise el historial de Kommo y compruebe el destinatario, el contenido y la hora del intento. Guardar esta revisión resuelve el bloqueo del intento; no vuelve a enviar ese mensaje.</p>
                <label className="block text-xs">Resultado comprobado
                  <select disabled={busy} value={outcome} onChange={event => { setOutcome(event.target.value as 'sent' | 'not_sent'); setReviewed(false) }} className="mt-1 block w-full rounded border border-stone-300 bg-white p-2">
                    <option value="not_sent">No se envió; cancelar este intento</option>
                    <option value="sent">Se envió; registrar el mensaje encontrado</option>
                  </select>
                </label>
                {outcome === 'sent' && <label className="block text-xs">Identificador del mensaje enviado en Kommo
                  <input required maxLength={200} disabled={busy} value={providerMessageId} onChange={event => setProviderMessageId(event.target.value)} className="mt-1 block w-full rounded border border-stone-300 bg-white p-2" />
                </label>}
                <label className="block text-xs">Referencia de la comprobación y observaciones
                  <textarea required minLength={10} maxLength={300} disabled={busy} value={reviewReference} onChange={event => setReviewReference(event.target.value)} className="mt-1 block w-full rounded border border-stone-300 bg-white p-2" />
                </label>
                <label className="flex items-start gap-2 text-xs"><input type="checkbox" required disabled={busy} checked={reviewed} onChange={event => setReviewed(event.target.checked)} className="mt-0.5" />He revisado el historial y comprobado que este resultado corresponde al intento y contacto indicados.</label>
                <button type="submit" disabled={busy || !reviewed || reviewReference.trim().length < 10 || outcome === 'sent' && !providerMessageId.trim()} className="rounded border border-amber-700 px-3 py-2 text-xs font-medium disabled:opacity-50">Guardar comprobación</button>
              </form>}
            </li>)}
          </ul>
          {health.incidentCount > health.incidents.length && <p className="mt-2 text-xs">Se muestran los últimos {health.incidents.length} intentos.</p>}
        </details>}
        {!!transport?.missing.length && <details className="mt-3" open>
          <summary className="cursor-pointer font-medium">{transport.missing.length} mensajes de Kommo sin registro en la automatización</summary>
          <p className="mt-2 text-xs">Revise el canal y el historial en Kommo. Estos eventos solo permiten comprobar que existe un mensaje; no contienen su texto ni autorizan reenviarlo.</p>
          <ul className="mt-2 space-y-1">{transport.missing.map(item => <li key={item.id}>
            <a className="underline" href={`https://lavilet.kommo.com/leads/detail/${item.kommoId}`} target="_blank" rel="noopener noreferrer">Lead #{item.kommoId}</a>
            {' · '}{new Date(item.at).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })} · Sin recepción registrada
          </li>)}</ul>
        </details>}
        {!!transport?.delayed.length && <details className="mt-3">
          <summary className="cursor-pointer font-medium">{transport.delayed.length} mensajes llegaron con más de 5 minutos de retraso</summary>
          <p className="mt-2 text-xs">Se compara la hora original del mensaje con su llegada al sistema. Este retraso es anterior al procesamiento de la IA.</p>
          <ul className="mt-2 space-y-1">{transport.delayed.map(item => <li key={item.id}>
            <a className="underline" href={`https://lavilet.kommo.com/leads/detail/${item.kommoId}`} target="_blank" rel="noopener noreferrer">Lead #{item.kommoId}</a>
            {' · '}{item.minutes} minutos de retraso
          </li>)}</ul>
        </details>}
        {transportIssue && <p className="mt-2 text-xs">Comprobación de las últimas 2 horas para leads activos del bot. El mantenimiento automático conserva los casos sin recepción para revisión; esta página actualiza la comprobación cada minuto. La aceptación del envío por Kommo no confirma su entrega en WhatsApp.</p>}
        {transport?.limited && transportIssue && <p className="mt-1 text-xs">Hay más eventos de los que cubre esta comprobación; revise también el historial de Kommo.</p>}
        {transport?.error && <p className="mt-2 text-xs">No se pudo consultar el registro de mensajes de Kommo. La comprobación se reintentará automáticamente. {transport.error}</p>}
        {admin && health?.blocked && <div className="mt-3">
          <button type="button" disabled={busy} onClick={() => void update('resume_after_account_review')} className="rounded-lg border border-amber-700 px-3 py-2 font-medium disabled:opacity-50">Ya revisé Kommo: reanudar pendientes</button>
          <p className="mt-1 text-xs">Permite procesar los mensajes nuevos que están en espera. Los intentos fallidos siguen en revisión. Si Kommo vuelve a rechazar el acceso, los envíos se pausarán otra vez.</p>
        </div>}
        {error && <p className="mt-2 text-red-700">{error}</p>}
      </div>
      <button type="button" aria-label="Actualizar estado de envíos" disabled={busy} onClick={() => void refresh()} className="p-1"><RefreshCw size={16} /></button>
    </div>
  </section>
}
