'use client'

import { useState, useTransition } from 'react'
import { SettingsHelp } from './SettingsHelp'
import { loadResponseReviewAction, saveResponseReviewAction, saveResponseReviewObservationAction } from '@/app/inmobiliaria/automatizacion/pruebas/review-actions'
import type { ResponseReviewResult } from '@/lib/inmobiliaria/responseReview'
import styles from './ConversationToneSettings.module.css'

export function ResponseReviewControl({ initial }: { initial: ResponseReviewResult }) {
  const [state, setState] = useState(initial.ok ? initial.state : null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState(initial.ok ? '' : initial.error)
  const [needsRefresh, setNeedsRefresh] = useState(!initial.ok)
  const [notice, setNotice] = useState('')
  function change(action: 'review' | 'observation' | 'refresh') {
    if (action !== 'refresh' && (!state || needsRefresh)) return
    setError(''); setNotice('')
    startTransition(async () => {
      try {
        const result = action === 'refresh' ? await loadResponseReviewAction()
          : action === 'observation' ? await saveResponseReviewObservationAction(!state!.observationOnly, state!.version)
            : await saveResponseReviewAction(!state!.enabled, state!.version)
        if (!result.ok) { setError(result.error); setNeedsRefresh(true); return }
        setState(result.state); setNeedsRefresh(false)
        setNotice(action === 'refresh' ? 'Estado actualizado.'
          : action === 'observation' ? result.state.observationOnly
            ? 'Modo demostración activado para los próximos mensajes de contactos de prueba. La revisión del borrador registra observaciones sin bloquearlo. La interpretación y la ruta del flujo conservan sus controles.'
            : 'Modo demostración desactivado. Los contactos de prueba vuelven a la configuración de revisión general.'
          : result.state.enabled ? 'Revisión activada para los próximos mensajes.' : 'Revisión desactivada para los próximos mensajes. El modo demostración también queda desactivado.')
      } catch {
        setError('No se pudo confirmar la respuesta del servidor. Pulse «Actualizar estado» antes de repetir la acción.')
        setNeedsRefresh(true)
      }
    })
  }
  const unavailable = pending || needsRefresh || !state
  return <section className={styles.card} aria-busy={pending} aria-labelledby="response-review-title">
    <h2 id="response-review-title">Revisión final de mensajes · Control general<SettingsHelp title="Revisión final de mensajes" configures="Activa o desactiva el revisor para todos los contactos autorizados del proyecto." usedByBot="Con revisión normal, contrasta hechos y obligaciones antes del envío. Al desactivarla no llama al revisor; las validaciones obligatorias y permisos de operaciones siguen activos y pueden detener una respuesta." applies="Incluye contactos de pruebas; es independiente de quién tiene habilitado el bot." saving="Pulsar Activar o Desactivar guarda inmediatamente. Desactivar la revisión también desactiva el modo demostración. Las respuestas ya en curso conservan su configuración. Actualizar estado solo consulta." /></h2>
    <p>La revisión general se aplica a todos los contactos autorizados de La Vilet, incluidos los números de prueba.</p>
    <p><strong>{needsRefresh || !state ? 'Estado pendiente de comprobar.' : state.enabled ? 'Revisión activada.' : 'Revisión desactivada.'}</strong>{' '}
      Desactivarla omite al revisor. Las validaciones obligatorias y las condiciones para ejecutar citas, reservas y otras acciones continúan.</p>
    <button type="button" className={styles.primary} disabled={unavailable} onClick={() => change('review')}>
      {pending ? 'Procesando…' : !state ? 'Revisión no disponible' : state.enabled ? 'Desactivar revisión general' : 'Activar revisión general'}
    </button>
    <div className={styles.observation} aria-labelledby="response-observation-title">
      <h3 id="response-observation-title">Modo demostración · Solo contactos de prueba<SettingsHelp title="Modo demostración" configures="Separa la revisión del borrador del redactor de su bloqueo únicamente para contactos de prueba habilitados." usedByBot="El redactor prepara el mensaje y su revisión conserva observaciones, incluso si rechaza el borrador o falla. Ese resultado no bloquea el borrador ni obliga a corregirlo. Los registros distinguen una respuesta observada de una aprobada." applies="Solo a contactos de prueba. Revisa sus borradores incluso si la revisión general está desactivada. El extractor, la planificación, las rutas y los permisos conservan su funcionamiento habitual. Sus errores y los fallos de envío pueden detener el flujo. Los demás contactos conservan su configuración general." saving="Activar guarda inmediatamente y revisa los contactos de prueba, sin cambiar la revisión general. Desactivar devuelve esos contactos a la configuración general. Cada mensaje toma la configuración al iniciar; no altera respuestas ya en curso." example="Si el revisor detecta una pregunta mal clasificada, el contacto de prueba recibe el borrador y el problema queda registrado para revisarlo después." /></h3>
      <p><strong>{needsRefresh || !state ? 'Estado pendiente de comprobar.' : state.observationOnly ? 'Demostración activada.' : 'Demostración desactivada.'}</strong>{' '}
        Revisa el borrador del redactor y registra sus observaciones sin bloquearlo ni exigir correcciones. Solo se aplica a contactos de prueba, incluso si la revisión general está desactivada. El extractor, la planificación y las rutas conservan sus controles habituales.</p>
      <button type="button" className={styles.primary} disabled={unavailable} aria-pressed={state?.observationOnly === true} onClick={() => change('observation')}>
        {pending ? 'Procesando…' : state?.observationOnly ? 'Desactivar modo demostración' : 'Activar modo demostración'}
      </button>
    </div>
    <button type="button" disabled={pending} onClick={() => change('refresh')}>Actualizar estado</button>
    <p className={styles.note}>Los cambios se aplican desde el siguiente mensaje. Las respuestas que ya estén en curso conservan su configuración.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div role="status" aria-live="polite">{notice}</div>
  </section>
}
