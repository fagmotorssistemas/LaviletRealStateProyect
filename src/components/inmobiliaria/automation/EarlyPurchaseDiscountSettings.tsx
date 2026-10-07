'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { SettingsFieldHelp } from './SettingsHelp'
import { loadEarlyPurchaseDiscountSettings, saveEarlyPurchaseDiscountSettings } from '@/app/inmobiliaria/automatizacion/descuentos/actions'
import { defaultEarlyPurchaseDiscountSettings, draftEarlyPurchaseDiscount, DISCOUNT_CATEGORIES, type DiscountRule, type EarlyPurchaseDiscountResult } from '@/lib/inmobiliaria/earlyPurchaseDiscounts'
import { AutomationSettingsHeader, automationSettingsStyles } from './AutomationSettings'
import styles from './EarlyPurchaseDiscountSettings.module.css'

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={styles.field}><span>{label}<SettingsFieldHelp title={label} section="descuentos" /></span>{children}</label> }
function Toggle({ label, value, onChange, disabled = false }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className={styles.toggle}><input type="checkbox" checked={value} disabled={disabled} onChange={event => onChange(event.target.checked)} />{label}<SettingsFieldHelp title={label} section="descuentos" /></label>
}
const referenceText = (rule: DiscountRule) => rule.referencePrices.map(reference => `${reference.unitNumber}=${reference.amount}`).join('\n')

export function EarlyPurchaseDiscountSettings({ initial }: { initial: EarlyPurchaseDiscountResult }) {
  const [state, setState] = useState(initial.ok ? initial.state : null)
  const [draft, setDraft] = useState(initial.ok ? initial.state.settings : defaultEarlyPurchaseDiscountSettings())
  const [units, setUnits] = useState<Record<string, string>>(() => Object.fromEntries(draft.rules.map(rule => [rule.id, rule.unitNumbers.join(', ')])))
  const [references, setReferences] = useState<Record<string, string>>(() => Object.fromEntries(draft.rules.map(rule => [rule.id, referenceText(rule)])))
  const [error, setError] = useState(initial.ok ? '' : initial.error)
  const [notice, setNotice] = useState('')
  const [pending, startTransition] = useTransition()
  const change = (id: string, values: Partial<DiscountRule>) => setDraft(previous => ({ ...previous, rules: previous.rules.map(rule => rule.id === id ? { ...rule, ...values } : rule) }))
  function submit(refresh = false) {
    setError(''); setNotice('')
    startTransition(async () => {
      try {
        const settings = refresh ? null : { ...draft, rules: draft.rules.map(rule => ({ ...rule,
          unitNumbers: (units[rule.id] || '').split(',').map(value => value.trim()).filter(Boolean),
          referencePrices: (references[rule.id] || '').split('\n').map(value => value.trim()).filter(Boolean).map(line => {
            const match = line.match(/^((?:LC-?)?\d{1,4})\s*=\s*(\d+(?:\.\d{1,2})?)$/i)
            if (!match) throw Error('Revise las referencias originales. Use una línea por unidad: 304=300000.00, sin separadores de miles.')
            return { unitNumber: match[1], amount: Number(match[2]) }
          }),
        })) }
        const result = refresh ? await loadEarlyPurchaseDiscountSettings() : await saveEarlyPurchaseDiscountSettings(settings, state?.version || '')
        if (!result.ok) { setError(result.error); return }
        setState(result.state); setDraft(result.state.settings)
        setUnits(Object.fromEntries(result.state.settings.rules.map(rule => [rule.id, rule.unitNumbers.join(', ')])))
        setReferences(Object.fromEntries(result.state.settings.rules.map(rule => [rule.id, referenceText(rule)])))
        setNotice(refresh ? 'Configuración actualizada.' : 'Cambios guardados para las siguientes respuestas del bot.')
      } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo confirmar la respuesta del servidor. Actualice antes de volver a guardar.') }
    })
  }
  function addRule() {
    const rule = draftEarlyPurchaseDiscount(`discount-${crypto.randomUUID()}`)
    setDraft(previous => ({ ...previous, rules: [...previous.rules, { ...rule, name: 'Nueva regla de descuento' }] }))
    setUnits(previous => ({ ...previous, [rule.id]: '' })); setReferences(previous => ({ ...previous, [rule.id]: '' }))
  }
  return <main className={automationSettingsStyles.shell}>
    <AutomationSettingsHeader active="descuentos" title="Descuentos por compra anticipada" description="Beneficios comerciales autorizados que el bot puede explicar sin confirmar una reserva ni una compra." project="La Vilet" />
    <form className={styles.form} onSubmit={event => { event.preventDefault(); submit() }} aria-busy={pending}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div role="status" aria-live="polite">{notice && <p className={styles.notice}>{notice}</p>}</div>
      <fieldset disabled={pending || !state}>
        <section className={styles.card}><h2>Uso de descuentos</h2>
          <Toggle label="Activar descuentos para todos los contactos del proyecto" value={draft.enabled} onChange={enabled => setDraft(previous => ({ ...previous, enabled }))} />
          <p>Se aplican a todos los leads cuando la automatización les atiende. El modo de pruebas determina quién recibe respuestas y se configura por separado.</p>
          <p>Se utiliza una sola regla por unidad. Tiene prioridad una regla para esa unidad, después una para su tipo de inmueble y finalmente una general. Las reglas con la misma prioridad y vigencia no pueden coincidir.</p>
          {!state?.saved && <p className={styles.draft}>El 5 % es un borrador desactivado. No se comunicará como beneficio hasta confirmar sus condiciones, fuente y vigencia, activar la regla y guardar.</p>}
        </section>
        {draft.rules.map((rule, index) => <section className={styles.card} key={rule.id}>
          <div className={styles.heading}><h2>{rule.name || `Regla ${index + 1}`}</h2><button type="button" className={styles.remove} onClick={() => setDraft(previous => ({ ...previous, rules: previous.rules.filter(value => value.id !== rule.id) }))}>Eliminar regla</button></div>
          <Toggle label="Usar esta regla de descuento" value={rule.enabled} onChange={enabled => change(rule.id, { enabled })} />
          <div className={styles.fields}>
            <Field label="Nombre de la regla"><input value={rule.name} maxLength={160} onChange={event => change(rule.id, { name: event.target.value })} /></Field>
            <Field label="Descuento (%)"><input type="number" min="0.01" max="99.99" step="any" value={Number.isFinite(rule.percent) ? rule.percent : ''} onChange={event => change(rule.id, { percent: event.target.value === '' ? NaN : Number(event.target.value) })} /></Field>
            <Field label="Etapa comercial"><select value={rule.mode} onChange={event => change(rule.id, { mode: event.target.value as DiscountRule['mode'] })}><option value="todos">Todas las etapas</option><option value="lanzamiento">Lanzamiento</option><option value="preventa">Preventa</option></select></Field>
            <Field label="Cómo se relaciona con el precio publicado"><select value={rule.base} onChange={event => change(rule.id, { base: event.target.value as DiscountRule['base'] })}><option value="catalog_additional">Se descuenta adicionalmente del catálogo</option><option value="included_in_catalog">Ya está incluido en el catálogo</option></select></Field>
            <Field label="Cuándo se obtiene el beneficio"><select value={rule.condition} onChange={event => change(rule.id, { condition: event.target.value as DiscountRule['condition'] })}><option value="reservation_confirmed">Con una reserva formal confirmada</option><option value="advance_purchase">Con una compra anticipada comprobada</option></select></Field>
            <Field label="Unidades específicas (opcional)"><input value={units[rule.id] || ''} maxLength={1000} onChange={event => setUnits(previous => ({ ...previous, [rule.id]: event.target.value }))} placeholder="304, 404, LC-02" /></Field>
          </div>
          <fieldset className={styles.scope}><legend>Tipos de inmueble (todos marcados: regla general)</legend>{DISCOUNT_CATEGORIES.map(category => <Toggle key={category} label={category} value={!rule.categories.length || rule.categories.includes(category)} disabled={rule.categories.length === 1 && rule.categories.includes(category)} onChange={checked => {
            const selected = rule.categories.length ? rule.categories : [...DISCOUNT_CATEGORIES]
            change(rule.id, { categories: checked ? [...new Set([...selected, category])] : selected.filter(value => value !== category) })
          }} />)}</fieldset>
          <p>Sin códigos, se consideran todas las unidades de los tipos elegidos. Con códigos, deben coincidir también con el tipo y la etapa.</p>
          <Field label="Condiciones comerciales autorizadas"><textarea value={rule.conditions} maxLength={1600} onChange={event => change(rule.id, { conditions: event.target.value })} placeholder="Qué debe cumplirse, qué cubre el beneficio y qué debe confirmar el equipo" /></Field>
          <p>Solicitar una reserva o hablar con un asesor no confirma una reserva formal. Este descuento no es la entrada ni el monto de reserva; tampoco garantiza disponibilidad.</p>
          {rule.base === 'included_in_catalog' && <div className={styles.included}>
            <p>El bot conservará el precio del catálogo y no volverá a restar el porcentaje. Para informar un ahorro en USD necesita el precio original autorizado de esa misma unidad. Sin esa referencia solo puede explicar el porcentaje y sus condiciones.</p>
            <Field label="Precios originales autorizados (opcional; una unidad por línea)"><textarea value={references[rule.id] || ''} onChange={event => setReferences(previous => ({ ...previous, [rule.id]: event.target.value }))} placeholder={'304=300000.00\n404=320000.00'} maxLength={3000} /></Field>
            <p>Esta referencia debe respaldar el porcentaje indicado. No es una promesa de un precio futuro.</p>
          </div>}
          <div className={styles.fields}>
            <Field label="Vigente desde"><input type="date" value={rule.startDate} onChange={event => change(rule.id, { startDate: event.target.value })} /></Field>
            <Field label="Vigente hasta (opcional)"><input type="date" value={rule.endDate} onChange={event => change(rule.id, { endDate: event.target.value })} /></Field>
            <Field label="Fuente verificada el"><input type="date" value={rule.checkedOn} onChange={event => change(rule.id, { checkedOn: event.target.value })} /></Field>
            <Field label="Revisar la fuente antes del (opcional)"><input type="date" value={rule.reviewBy} onChange={event => change(rule.id, { reviewBy: event.target.value })} /></Field>
          </div>
          <Field label="Fuente o documento que autoriza el descuento"><textarea value={rule.source} maxLength={1600} onChange={event => change(rule.id, { source: event.target.value })} /></Field>
          <p>Las reglas vencidas o con fuente pendiente de revisión dejan de usarse para comunicar y calcular descuentos.</p>
        </section>)}
        <button type="button" className={styles.add} disabled={draft.rules.length >= 30} onClick={addRule}>Agregar regla de descuento</button>
      </fieldset>
      <div className={styles.actions}><button type="submit" disabled={pending || !state}>Guardar descuentos</button><button type="button" disabled={pending} onClick={() => submit(true)}>Actualizar configuración</button></div>
    </form>
  </main>
}
