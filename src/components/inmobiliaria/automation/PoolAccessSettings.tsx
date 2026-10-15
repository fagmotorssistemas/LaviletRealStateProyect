'use client'
import { useState, useTransition } from 'react'
import { loadPoolAccess, savePoolAccess } from '@/app/inmobiliaria/automatizacion/instalaciones/actions'
import type { PoolAccessResult } from '@/lib/inmobiliaria/poolAccess'
import { AutomationSettingsHeader, automationSettingsStyles } from './AutomationSettings'
import styles from './EarlyPurchaseDiscountSettings.module.css'

export function PoolAccessSettings({ initial }: { initial: PoolAccessResult }) {
  const [state, setState] = useState(initial.ok ? initial.state : null)
  const [allowed, setAllowed] = useState(initial.ok ? initial.state.settings.allowTemporaryGuests : false)
  const [error, setError] = useState(initial.ok ? '' : initial.error), [notice, setNotice] = useState('')
  const [pending, startTransition] = useTransition()
  function submit(refresh = false) {
    setError(''); setNotice('')
    startTransition(async () => {
      try {
        const result = refresh ? await loadPoolAccess() : await savePoolAccess({ allowTemporaryGuests: allowed }, state?.version || '')
        if (!result.ok) { setError(result.error); return }
        setState(result.state); setAllowed(result.state.settings.allowTemporaryGuests)
        setNotice(refresh ? 'Configuración actualizada.' : 'Condición guardada para las próximas respuestas del bot.')
      } catch { setError('No se pudo confirmar el cambio. Actualice antes de volver a guardar.') }
    })
  }
  return <main className={automationSettingsStyles.shell}>
    <AutomationSettingsHeader active="instalaciones" title="Instalaciones y piscina" description="Defina quién puede utilizar la piscina para que el bot responda con la condición vigente." project="La Vilet" />
    <form className={styles.form} aria-busy={pending} onSubmit={event => { event.preventDefault(); submit() }}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div role="status" aria-live="polite">{notice && <p className={styles.notice}>{notice}</p>}</div>
      <fieldset disabled={pending || !state}><section className={styles.card}><h2>Acceso a la piscina</h2>
        <p>Los residentes mantienen el acceso. Un inquilino que vive en el edificio también es residente.</p>
        <label className={styles.toggle}><input type="checkbox" checked={allowed} onChange={event => setAllowed(event.target.checked)} />Permitir acceso a huéspedes de alquiler temporal (Airbnb)</label>
        <p>{allowed ? 'Los residentes y los huéspedes de alquiler temporal pueden utilizar la piscina.' : 'La piscina es exclusiva para residentes. Los huéspedes de alquiler temporal no tienen acceso.'}</p>
        <p>Esta opción solo modifica el acceso a la piscina. Los cobros de acceso, alícuotas y el uso de otras instalaciones se definen por separado.</p>
      </section></fieldset>
      <div className={styles.actions}><button type="submit" disabled={pending || !state}>Guardar condición de acceso</button><button type="button" disabled={pending} onClick={() => submit(true)}>Actualizar configuración</button></div>
    </form>
  </main>
}
