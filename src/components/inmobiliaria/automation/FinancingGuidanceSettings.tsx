'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { SettingsFieldHelp } from './SettingsHelp'
import { loadFinancingGuidance, saveFinancingGuidance } from '@/app/inmobiliaria/automatizacion/financiamiento/actions'
import { defaultFinancingGuidance, type FinancingGuidanceResult, type GuidanceSource, type EntryRequirement } from '@/lib/inmobiliaria/financingGuidance'
import { AutomationSettingsHeader, automationSettingsStyles } from './AutomationSettings'
import styles from './FinancingGuidanceSettings.module.css'

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={styles.field}><span>{label}<SettingsFieldHelp title={label} section="financiamiento" /></span>{children}</label> }
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className={styles.check}><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />{label}<SettingsFieldHelp title={label} section="financiamiento" /></label>
}
function NumberField({ label, value, onChange, max }: { label: string; value: number | null; onChange: (v: number | null) => void; max?: number }) {
  return <Field label={label}><input type="number" min="0" max={max} step="any" value={value ?? ''} placeholder="Sin confirmar" onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} /></Field>
}
function Requirement({ value, onChange }: { value: EntryRequirement; onChange: (v: EntryRequirement) => void }) {
  return <Field label="Condición del proyecto"><select value={value} onChange={e => onChange(e.target.value as EntryRequirement)}>
    <option value="unconfirmed">Por confirmar</option><option value="required">Se requiere</option><option value="not_required">El proyecto no la exige</option>
  </select></Field>
}
function Source({ value, onChange }: { value: GuidanceSource; onChange: (v: Partial<GuidanceSource>) => void }) {
  return <div className={styles.source}><p>Fuente autorizada y fecha de comprobación. La fecha de próxima revisión es un control interno: al vencer se dejan de comunicar y calcular estas condiciones.</p>
    <Field label="Fuente o documento autorizado"><textarea value={value.source} maxLength={1200} onChange={e => onChange({ source: e.target.value })} /></Field>
    <div className={styles.fields}><Field label="Verificado el"><input type="date" value={value.checkedOn} onChange={e => onChange({ checkedOn: e.target.value })} /></Field>
      <Field label="Revisar antes del (opcional)"><input type="date" value={value.reviewBy} onChange={e => onChange({ reviewBy: e.target.value })} /></Field></div>
  </div>
}
function Categories({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return <div><p>Tipos de inmueble a los que aplica</p><div className={styles.scope}>{['suite', 'departamento', 'penthouse', 'local'].map(c =>
    <Toggle key={c} label={c} value={value.includes(c)} onChange={checked => onChange(checked ? [...value, c] : value.filter(v => v !== c))} />)}</div></div>
}

export function FinancingGuidanceSettings({ initial }: { initial: FinancingGuidanceResult }) {
  const [state, setState] = useState(initial.ok ? initial.state : null)
  const [draft, setDraft] = useState(initial.ok ? initial.state.settings : defaultFinancingGuidance())
  const [unitText, setUnitText] = useState(initial.ok ? initial.state.settings.entry.unitNumbers.join(', ') : '')
  const [error, setError] = useState(initial.ok ? '' : initial.error)
  const [notice, setNotice] = useState('')
  const [pending, startTransition] = useTransition()
  const entry = draft.entry, reservation = draft.reservation
  const changeEntry = (v: Partial<typeof entry>) => setDraft(d => ({ ...d, entry: { ...d.entry, ...v } }))
  const changeReservation = (v: Partial<typeof reservation>) => setDraft(d => ({ ...d, reservation: { ...d.reservation, ...v } }))
  function submit(refresh = false) {
    setError(''); setNotice('')
    startTransition(async () => {
      try {
        const result = refresh ? await loadFinancingGuidance() : await saveFinancingGuidance(draft, state?.version || '')
        if (!result.ok) { setError(result.error); return }
        setState(result.state); setDraft(result.state.settings); setUnitText(result.state.settings.entry.unitNumbers.join(', '))
        setNotice(refresh ? 'Configuración actualizada.' : 'Cambios guardados. Se aplican desde las siguientes respuestas del bot.')
      } catch { setError('No se pudo confirmar la respuesta del servidor. Actualice antes de volver a guardar.') }
    })
  }
  return <main className={automationSettingsStyles.shell}>
    <AutomationSettingsHeader active="financiamiento" title="Entrada y financiamiento" description="Condiciones que el bot puede comunicar y usar para orientar al cliente." project="La Vilet" />
    <form className={styles.form} onSubmit={e => { e.preventDefault(); submit() }} aria-busy={pending}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div role="status" aria-live="polite">{notice && <p className={styles.status}>{notice}</p>}</div>
      <fieldset disabled={pending || !state}>
        <section className={styles.card}><h2>Uso de estas condiciones</h2>
          <Toggle label="Activar condiciones de entrada, reserva y entidades" value={draft.enabled} onChange={enabled => setDraft(d => ({ ...d, enabled }))} />
          <Toggle label="Permitir cálculos orientativos de entrada y cuota" value={draft.estimatesEnabled} onChange={estimatesEnabled => setDraft(d => ({ ...d, estimatesEnabled }))} />
          <p>Desactivar no significa que la entrada sea cero. Los valores sin confirmar quedan pendientes. Las referencias públicas no confirman un convenio ni la aprobación de crédito; solo se usan para entidades habilitadas para el proyecto.</p>
          {!state?.saved && <p>Se muestran referencias públicas iniciales de JEP y Pichincha. La entrada y la reserva del proyecto siguen sin confirmar.</p>}
        </section>
        <section className={styles.card}><h2>Entrada exigida por el proyecto</h2>
          <Toggle label="Usar esta regla de entrada" value={entry.enabled} onChange={enabled => changeEntry({ enabled })} />
          <div className={styles.fields}><Requirement value={entry.requirement} onChange={requirement => changeEntry({ requirement })} />
            <Field label="Forma de definir la entrada"><select value={entry.kind} onChange={e => changeEntry({ kind: e.target.value as 'percent' | 'amount', value: null })}><option value="percent">Porcentaje del precio</option><option value="amount">Monto fijo en USD</option></select></Field>
            <NumberField label={entry.kind === 'percent' ? 'Entrada (%)' : 'Entrada (USD)'} value={entry.value} max={entry.kind === 'percent' ? 100 : undefined} onChange={value => changeEntry({ value })} />
            <Field label="Cuándo se paga"><input value={entry.due} maxLength={600} onChange={e => changeEntry({ due: e.target.value })} placeholder="Por ejemplo, al firmar la promesa" /></Field>
            <Field label="Etapa comercial"><select value={entry.mode} onChange={e => changeEntry({ mode: e.target.value as typeof entry.mode })}><option value="todos">Todas</option><option value="lanzamiento">Lanzamiento</option><option value="preventa">Preventa</option></select></Field>
            <Field label="Unidades (vacío: todas las del tipo elegido)"><input value={unitText} onChange={e => { setUnitText(e.target.value); changeEntry({ unitNumbers: e.target.value.split(',').map(v => v.trim()).filter(Boolean) }) }} placeholder="502, 601" /></Field>
          </div><Categories value={entry.categories} onChange={categories => changeEntry({ categories })} />
          <p>La aportación propia exigida por la entidad puede ser mayor. No se suman ambas entradas como si fueran pagos distintos.</p>
          <Source value={entry} onChange={changeEntry} />
        </section>
        <section className={styles.card}><h2>Reserva</h2>
          <Toggle label="Usar condiciones de reserva" value={reservation.enabled} onChange={enabled => changeReservation({ enabled })} />
          <div className={styles.fields}><Requirement value={reservation.requirement} onChange={requirement => changeReservation({ requirement })} />
            <NumberField label="Monto de reserva (USD)" value={reservation.amount} onChange={amount => changeReservation({ amount })} />
            <Field label="¿Se abona a la entrada?"><select value={reservation.creditedToEntry === null ? '' : String(reservation.creditedToEntry)} onChange={e => changeReservation({ creditedToEntry: e.target.value === '' ? null : e.target.value === 'true' })}><option value="">Por confirmar</option><option value="true">Sí</option><option value="false">No</option></select></Field>
          </div><Field label="Condiciones, vigencia y devolución"><textarea value={reservation.conditions} maxLength={1200} onChange={e => changeReservation({ conditions: e.target.value })} /></Field>
          <p>Informar una reserva no la ejecuta. Se conserva el flujo de evaluación y contacto con el equipo.</p><Source value={reservation} onChange={changeReservation} />
        </section>
        {draft.lenders.map(lender => {
          const change = (v: Partial<typeof lender>) => setDraft(d => ({ ...d, lenders: d.lenders.map(l => l.id === lender.id ? { ...l, ...v } : l) }))
          return <section className={styles.card} key={lender.id}><h2>{lender.name}</h2>
            <Toggle label="Usar condiciones publicadas de esta entidad" value={lender.enabled} onChange={enabled => change({ enabled })} />
            <div className={styles.fields}>
              <Field label="Producto"><input value={lender.product} maxLength={120} onChange={e => change({ product: e.target.value })} /></Field>
              <NumberField label="Porcentaje anunciado, incluidos gastos (%)" value={lender.advertisedPercent} max={100} onChange={advertisedPercent => change({ advertisedPercent })} />
              <NumberField label="Porcentaje aplicable al precio del inmueble (%)" value={lender.purchasePercent} max={100} onChange={purchasePercent => change({ purchasePercent })} />
              <NumberField label="Límite del préstamo (USD)" value={lender.maxAmount} onChange={maxAmount => change({ maxAmount })} />
              <NumberField label="Tasa anual (%)" value={lender.annualRate} max={100} onChange={annualRate => change({ annualRate })} />
              <Field label="Tipo de tasa"><select value={lender.rateType} onChange={e => change({ rateType: e.target.value as typeof lender.rateType })}><option value="unconfirmed">Por confirmar</option><option value="nominal_annual">Nominal anual</option><option value="effective_annual">Efectiva anual</option></select></Field>
              <Field label="Cómo se comunica la tasa"><select value={lender.rateQualification} onChange={e => change({ rateQualification: e.target.value as typeof lender.rateQualification })}><option value="from">Desde (sujeta a evaluación)</option><option value="reference">Referencia sujeta a evaluación</option></select></Field>
              <NumberField label="Plazo mínimo (años)" value={lender.minYears} onChange={minYears => change({ minYears })} />
              <NumberField label="Plazo máximo (años)" value={lender.maxYears} onChange={maxYears => change({ maxYears })} />
              <NumberField label="Plazo de ejemplo (años, opcional)" value={lender.exampleYears} onChange={exampleYears => change({ exampleYears })} />
              <NumberField label="Cargos mensuales conocidos (USD, opcional)" value={lender.monthlyCharges} onChange={monthlyCharges => change({ monthlyCharges })} />
            </div><Categories value={lender.categories} onChange={categories => change({ categories })} />
            <Field label="Alcance y condiciones adicionales"><textarea value={lender.notes} maxLength={2000} onChange={e => change({ notes: e.target.value })} /></Field>
            <p>La cuota básica necesita tasa, tipo de tasa y plazo confirmados. Excluye gracia, gastos financiados y cargos no configurados. Dejar un campo vacío significa desconocido, no cero.</p>
            <Source value={lender} onChange={change} />
          </section>
        })}
      </fieldset>
      <div className={styles.actions}><button type="submit" disabled={pending || !state}>Guardar condiciones</button><button type="button" disabled={pending} onClick={() => submit(true)}>Actualizar configuración</button></div>
    </form>
  </main>
}
