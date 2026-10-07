'use client'

import { useState, useTransition } from 'react'
import { SettingsHelp } from './SettingsHelp'
import { loadResponseReviewAction, saveResponseReviewAction } from '@/app/inmobiliaria/automatizacion/pruebas/review-actions'
import type { ResponseReviewResult } from '@/lib/inmobiliaria/responseReview'
import styles from './ConversationToneSettings.module.css'

export function ResponseReviewControl({ initial }: { initial: ResponseReviewResult }) {
  const [state, setState] = useState(initial.ok ? initial.state : null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState(initial.ok ? '' : initial.error)
  const [needsRefresh, setNeedsRefresh] = useState(!initial.ok)
  const [notice, setNotice] = useState('')
  function change(refresh = false) {
    if (!refresh && (!state || needsRefresh)) return
    setError(''); setNotice('')
    startTransition(async () => {
      try {
        const result = refresh ? await loadResponseReviewAction() : await saveResponseReviewAction(!state!.enabled, state!.version)
        if (!result.ok) { setError(result.error); setNeedsRefresh(true); return }
        setState(result.state); setNeedsRefresh(false)
        setNotice(refresh ? 'Estado actualizado.' : result.state.enabled ? 'Revisión activada para los próximos mensajes.' : 'Revisión desactivada para los próximos mensajes.')
      } catch {
        setError('No se pudo confirmar la respuesta del servidor. Pulse «Actualizar estado» antes de repetir la acción.')
        setNeedsRefresh(true)
      }
    })
  }
  return <section className={styles.card} aria-busy={pending} aria-labelledby="response-review-title">
    <h2 id="response-review-title">Revisión final de mensajes · Control general<SettingsHelp title="Revisión final de mensajes" configures="Activa o desactiva la revisión del borrador para todos los contactos autorizados del proyecto." usedByBot="El revisor contrasta hechos y obligaciones antes del envío. Desactivarlo envía el primer borrador sin esas correcciones comerciales; los controles técnicos y permisos de operaciones continúan." applies="Incluye contactos de pruebas; es independiente de quién tiene habilitado el bot." saving="Pulsar Activar o Desactivar guarda inmediatamente. Las respuestas ya en curso conservan su configuración. Actualizar estado solo consulta la configuración guardada." /></h2>
    <p>Se aplica a todos los contactos autorizados de La Vilet, incluidos los números de prueba.</p>
    <p><strong>{needsRefresh || !state ? 'Estado pendiente de comprobar.' : state.enabled ? 'Revisión activada.' : 'Revisión desactivada.'}</strong>{' '}
      Al desactivarla, se envía el primer borrador del redactor sin revisor, correcciones automáticas ni validaciones comerciales posteriores.
      Se mantienen los controles técnicos de envío y las condiciones para ejecutar citas, reservas y otras acciones.</p>
    <button type="button" className={styles.primary} disabled={pending || needsRefresh || !state} onClick={() => change()}>
      {pending ? 'Procesando…' : !state ? 'Revisión no disponible' : state.enabled ? 'Desactivar revisión general' : 'Activar revisión general'}
    </button>
    <button type="button" disabled={pending} onClick={() => change(true)}>Actualizar estado</button>
    <p className={styles.note}>El cambio se aplica desde el siguiente mensaje. Las respuestas que ya estén en curso conservan su configuración.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div role="status" aria-live="polite">{notice}</div>
  </section>
}
