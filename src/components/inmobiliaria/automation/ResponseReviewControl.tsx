'use client'

import { useState, useTransition } from 'react'
import { saveResponseReviewAction } from '@/app/inmobiliaria/automatizacion/pruebas/review-actions'
import type { ResponseReviewState } from '@/lib/inmobiliaria/responseReview'
import styles from './ConversationToneSettings.module.css'

export function ResponseReviewControl({ initial }: { initial: ResponseReviewState }) {
  const [state, setState] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  function toggle() {
    setError(''); setNotice('')
    startTransition(async () => {
      try {
        const saved = await saveResponseReviewAction(!state.enabled, state.version)
        setState(saved)
        setNotice(saved.enabled ? 'Revisión activada para los próximos mensajes.' : 'Revisión desactivada para los próximos mensajes.')
      } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio.') }
    })
  }
  return <section className={styles.card} aria-busy={pending} aria-labelledby="response-review-title">
    <h2 id="response-review-title">Revisión de respuestas · Control general</h2>
    <p>Se aplica a todos los contactos autorizados de La Vilet, incluidos los números de prueba.</p>
    <p><strong>{state.enabled ? 'Revisión activada.' : 'Revisión desactivada.'}</strong>{' '}
      Al desactivarla, se envía el primer borrador del redactor sin revisor, correcciones automáticas ni validaciones comerciales posteriores.
      Se mantienen los controles técnicos de envío y las condiciones para ejecutar citas, reservas y otras acciones.</p>
    <button type="button" className={styles.primary} disabled={pending} onClick={toggle}>
      {pending ? 'Guardando…' : state.enabled ? 'Desactivar revisión general' : 'Activar revisión general'}
    </button>
    <p className={styles.note}>El cambio se aplica desde el siguiente mensaje. Las respuestas que ya estén en curso conservan su configuración.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div role="status" aria-live="polite">{notice}</div>
  </section>
}
