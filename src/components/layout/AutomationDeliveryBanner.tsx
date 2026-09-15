'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { canAccessPath } from '@/lib/inmobiliaria/roleAccess'
import type { deliveryHealth } from '@/lib/integrations/automation/delivery-state'

type Health = Awaited<ReturnType<typeof deliveryHealth>>

export function AutomationDeliveryBanner() {
  const { profile } = useAuth()
  const allowed = canAccessPath(profile?.role, '/inmobiliaria/automatizacion', profile?.crm_paths)
  const admin = profile?.role === 'admin'
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
  async function update(action: string, id?: string) {
    setBusy(true)
    try {
      const response = await fetch('/api/integrations/delivery', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }) })
      const result = await response.json()
      if (!response.ok) throw Error(result.error || 'No se pudo guardar la revisión.')
      setHealth(result); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la revisión.') }
    finally { setBusy(false) }
  }
  if (!allowed || (!error && !health?.blocked && !health?.incidentCount)) return null
  const reason = health?.httpStatus === 402 ? 'Kommo rechazó las solicitudes con «Payment Required» (402). Revise la suscripción o consulte a soporte de Kommo.'
    : health?.httpStatus === 401 ? 'Kommo rechazó las credenciales (401). Un administrador debe revisar la conexión.'
      : 'Kommo rechazó el acceso (403). Un administrador debe revisar los permisos de la integración.'
  return <section role="status" aria-live="polite" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-stone-800">
    <div className="flex items-start gap-3">
      <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-700" />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">{health?.blocked ? 'Los envíos del bot están bloqueados por Kommo' : health?.incidentCount ? 'Hay respuestas que necesitan revisión' : 'No se pudo verificar el estado del bot'}</h2>
        {health?.blocked && <><p className="mt-1">{reason}</p><p className="mt-1">Los nuevos mensajes se conservan pendientes. Cambiar «Detener IA» o reiniciar al lead no elimina este bloqueo.</p></>}
        {!!health?.pendingMessages && health.blocked && <p className="mt-1">Mensajes pendientes: {health.pendingMessages}.</p>}
        {!!health?.incidentCount && <details className="mt-3">
          <summary className="cursor-pointer font-medium">Revisar {health.incidentCount} {health.incidentCount === 1 ? 'intento sin respuesta confirmada' : 'intentos sin respuesta confirmada'}</summary>
          <p className="mt-2 text-xs">Compruebe la conversación en Kommo y atienda lo pendiente. Estos intentos no se reenvían automáticamente. Un envío de resultado desconocido requiere revisar el historial antes de desbloquearlo.</p>
          <ul className="mt-2 space-y-2">
            {health.incidents.map(item => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-amber-200 bg-white/60 px-3 py-2">
              {item.kommoId ? <a className="inline-flex items-center gap-1 underline" href={`https://lavilet.kommo.com/leads/detail/${item.kommoId}`} target="_blank" rel="noopener noreferrer">Lead #{item.kommoId}<ExternalLink size={12} /></a> : <span>Automatización</span>}
              <span className="text-xs">{item.delivery === 'rejected' ? 'Solicitud rechazada; mensaje no enviado' : item.delivery === 'not_sent' ? 'Venció el plazo para responder; necesita atención' : 'Resultado del envío por comprobar'} · {item.reason}</span>
              {admin && item.delivery !== 'unknown' && !health.blocked && <button type="button" disabled={busy} onClick={() => void update('incident_reviewed', item.id)} className="ml-auto text-xs font-medium underline disabled:opacity-50">Ya atendí esta conversación</button>}
            </li>)}
          </ul>
          {health.incidentCount > health.incidents.length && <p className="mt-2 text-xs">Se muestran los últimos {health.incidents.length} intentos.</p>}
        </details>}
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
