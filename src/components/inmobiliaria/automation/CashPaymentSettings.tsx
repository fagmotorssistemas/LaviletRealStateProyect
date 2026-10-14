'use client'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { defaultCashPaymentRules, type CashPaymentResult, type CashPaymentRules } from '@/lib/inmobiliaria/cashPaymentRules'
import { loadCashPaymentRules, saveCashPaymentRules } from '@/app/inmobiliaria/automatizacion/contado/actions'
import { AutomationSettingsHeader, automationSettingsStyles } from './AutomationSettings'
import styles from './EarlyPurchaseDiscountSettings.module.css'

export function CashPaymentSettings({ initial }: { initial: CashPaymentResult }) {
  const [state, setState] = useState(initial.ok ? initial.state : null)
  const [draft, setDraft] = useState(initial.ok ? initial.state.settings : defaultCashPaymentRules())
  const [error, setError] = useState(initial.ok ? '' : initial.error)
  const [notice, setNotice] = useState('')
  const [pending, startTransition] = useTransition()
  const update = (values: Partial<CashPaymentRules>) => setDraft(previous => ({ ...previous, ...values }))
  const submit = (refresh = false) => {
    setError(''); setNotice('')
    startTransition(async () => {
      try {
        const result = refresh ? await loadCashPaymentRules() : await saveCashPaymentRules(draft, state?.version || '')
        if (!result.ok) { setError(result.error); return }
        setState(result.state); setDraft(result.state.settings)
        setNotice(refresh ? 'Configuración actualizada.' : 'Condiciones guardadas para las siguientes respuestas del bot.')
      } catch { setError('No se pudo confirmar el resultado. Actualice antes de volver a guardar.') }
    })
  }
  return <main className={automationSettingsStyles.shell}>
    <AutomationSettingsHeader active="contado" title="Pagos al contado" description="Condiciones aprobadas que el asistente puede explicar sobre pagos con fondos propios." project="La Vilet" />
    <form className={styles.form} onSubmit={event => { event.preventDefault(); submit() }} aria-busy={pending}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div role="status" aria-live="polite">{notice && <p className={styles.notice}>{notice}</p>}</div>
      <fieldset disabled={pending || !state}>
        <section className={styles.card}><h2>Condiciones del proyecto</h2>
          <label className={styles.toggle}><input type="checkbox" checked={draft.enabled} onChange={event => update({ enabled: event.target.checked })} />Permitir que el bot comunique estas condiciones</label>
          <p>Complete únicamente condiciones aprobadas. Los campos vacíos quedan por confirmar. Estas reglas no ofrecen crédito directo ni confirman una reserva o un pago.</p>
          <label className={styles.field}><span>Etapa comercial</span><select value={draft.mode} onChange={event => update({ mode: event.target.value as CashPaymentRules['mode'] })}><option value="todos">Todas las etapas</option><option value="lanzamiento">Lanzamiento</option><option value="preventa">Preventa</option></select></label>
          {([
            ['definition', 'Qué considera el proyecto un pago al contado'], ['timing', 'Cuándo y cómo se completa el precio'],
            ['reservation', 'Cómo se trata el pago de reserva'], ['expenses', 'Gastos incluidos y gastos adicionales'],
          ] as const).map(([key, label]) => <label key={key} className={styles.field}><span>{label}</span><textarea value={draft[key]} maxLength={1600} placeholder="Sin confirmar" onChange={event => update({ [key]: event.target.value })} /></label>)}
        </section>
        <section className={styles.card}><h2>Descuento por pago al contado</h2>
          <label className={styles.field}><span>Condición aprobada</span><select value={draft.discount} onChange={event => update({ discount: event.target.value as CashPaymentRules['discount'] })}><option value="unconfirmed">Todavía no está definido</option><option value="none">No hay descuento adicional por pagar al contado</option><option value="discount_rules">Consultar las reglas de descuentos vigentes</option></select></label>
          <p>Un descuento de lanzamiento ya incluido en el catálogo no se resta otra vez. Las rebajas personales las revisa un asesor. Los porcentajes y su alcance se configuran en una sola sección.</p>
          <Link href="/inmobiliaria/automatizacion/descuentos" className="font-semibold underline">Abrir descuentos</Link>
        </section>
        <section className={styles.card}><h2>Fuente de las condiciones</h2>
          <label className={styles.field}><span>Documento o responsable que las autoriza</span><textarea value={draft.source} maxLength={1600} onChange={event => update({ source: event.target.value })} /></label>
          <div className={styles.fields}><label className={styles.field}><span>Verificado el</span><input type="date" value={draft.checkedOn} onChange={event => update({ checkedOn: event.target.value })} /></label>
            <label className={styles.field}><span>Revisar antes del (opcional)</span><input type="date" value={draft.reviewBy} onChange={event => update({ reviewBy: event.target.value })} /></label></div>
          <p>Si vence la revisión, las condiciones dejan de comunicarse hasta verificarlas nuevamente.</p>
        </section>
      </fieldset>
      <div className={styles.actions}><button type="submit" disabled={pending || !state}>Guardar reglas de contado</button><button type="button" disabled={pending} onClick={() => submit(true)}>Actualizar configuración</button></div>
    </form>
  </main>
}
