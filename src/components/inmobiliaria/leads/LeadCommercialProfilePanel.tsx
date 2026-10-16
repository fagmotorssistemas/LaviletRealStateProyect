'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Building2, CalendarDays, ClipboardList, History, Landmark, Loader2, RefreshCw, Sprout } from 'lucide-react'
import { getLeadPipelineDetailAction, updateLeadPipelineMetadataAction } from '@/app/inmobiliaria/leads/pipeline-actions'
import type { LeadPipelineDetail, LeadPipelineMetadataInput } from '@/types/leadPipelineDetail'
import { LEAD_PIPELINE_STAGE_OPTIONS } from '@/types/leadPipeline'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { datetimeLocalToIso, formatAgendaDateTime, isoToDatetimeLocal } from '@/lib/inmobiliaria/agendaTime'
import styles from './LeadCommercialProfilePanel.module.css'
import { LeadPipelineWarnings } from './LeadPipelineWarnings'
import { LeadProfileCard } from '@/components/inmobiliaria/automation/LeadProfileCard'
import { nextActionDescription } from '@/lib/inmobiliaria/leadPipeline'

type PanelProps = {
  leadId: string
  onUpdated: () => void
  onOpenAgenda?: () => void
  onOpenShowroom?: () => void
  onOpenTour?: () => void
  initialData?: LeadPipelineDetail
  onDataChanged?: (data: LeadPipelineDetail) => void
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return <section className={styles.section}>
    <div className={styles.sectionHeading}><h3 className={styles.sectionTitle}>{icon}{title}</h3></div>
    <div className={styles.sectionBody}>{children}</div>
  </section>
}

function Fields({ values }: { values: [string, string | null | undefined][] }) {
  return <dl className={styles.fields}>{values.map(([label, value]) => <div key={label} className={styles.field}>
    <dt className={styles.term}>{label === 'Etapa actual' ? 'Próxima acción del bot' : label}</dt>
    <dd className={styles.description}>{value || 'Sin información registrada'}</dd>
  </div>)}</dl>
}

const jobNames: Record<string, string> = {
  nutrition_24h: 'Seguimiento de 24 horas', nutrition_week_one: 'Seguimiento de 7 días',
  nutrition_week_two: 'Seguimiento de 14 días', nutrition_week_three: 'Seguimiento de 21 días',
}
const jobStatuses: Record<string, string> = {
  pending: 'Pendiente', processing: 'En proceso', claimed: 'En proceso', completed: 'Finalizado',
  cancelled: 'Cancelado', failed: 'Con error', uncertain: 'Resultado por comprobar',
}
const financeStatuses: Record<string, string> = {
  borrador: 'Recopilación de datos', lista: 'Datos completos; pendiente de revisión',
  en_proceso: 'En proceso', pending: 'Pendiente',
}
const stageName = (stage: string) => LEAD_PIPELINE_STAGE_OPTIONS.find(option => option.value === stage)?.label || stage
const sourceNames: Record<string, string> = {
  messages: 'Mensaje registrado', lead_score_events: 'Interés interpretado del mensaje',
  'conversation._interpretation_memory.property': 'Declaración conservada del lead', leads: 'Datos del CRM',
  'conversation._property_context.selected_ids': 'Elección declarada de unidad', appointments: 'Gestión de cita',
  lead_reservation_requests: 'Solicitud operativa de reserva', unit_sales_closings: 'Cierre de venta registrado',
}
const actorName = (value: string) => /^[\p{L}][\p{L}\p{M}\s.'’-]{1,100}$/u.test(value.trim()) ? value : 'Equipo comercial'

function ProcessSections({ data, onOpenAgenda, onOpenShowroom, onOpenTour }: { data: LeadPipelineDetail } & Pick<PanelProps, 'onOpenAgenda' | 'onOpenShowroom' | 'onOpenTour'>) {
  return <>
    <Section title="Citas" icon={<CalendarDays size={15} />}>
      {data.appointments.length ? data.appointments.map(appointment => <div key={appointment.id} className={styles.record}>
        <div className={styles.recordHeading}><h4 className={styles.recordTitle}>{appointment.label}</h4>
          <span className={styles.recordDate}>{appointment.scheduledAt ? formatAgendaDateTime(appointment.scheduledAt) : 'Horario pendiente'}</span></div>
        <p className={styles.detail}>{[appointment.advisor, appointment.location].filter(Boolean).join(' · ') || 'Responsable o lugar por completar'}</p>
      </div>) : <p className={styles.empty}>{data.pipeline.coverage.appointments === false ? 'No se pudieron comprobar las citas. Reintente la carga.' : 'No hay citas registradas en esta ficha. Una invitación del bot no confirma una cita.'}</p>}
      {onOpenAgenda && <button type="button" className={`${styles.refresh} mt-3`} onClick={onOpenAgenda}>Abrir agenda del lead</button>}
    </Section>
    <Section title="Financiamiento" icon={<Landmark size={15} />}>
      {data.pipeline.coverage.financing === false ? <p className={styles.empty}>No se pudo comprobar el estado financiero. Reintente la carga.</p> : <Fields values={[
        ['Aceptación del lead', data.financing.accepted ? 'Aceptó continuar con la orientación financiera' : 'Sin aceptación registrada'],
        ['Entidad', data.financing.partner],
        ['Estado del expediente', data.financing.status ? financeStatuses[data.financing.status] || data.financing.status : 'Sin expediente registrado'],
      ]} />}
      <p className={styles.detail}>Consultar cuotas o completar datos no acredita aprobación de crédito. El resultado de una revisión se presenta únicamente cuando está registrado.</p>
      {data.financialReview && <LeadProfileCard leadId={data.metadata.leadId} data={data.financialReview} showGroups={false} />}
    </Section>
    <Section title="Solicitudes de reserva" icon={<Building2 size={15} />}>
      {data.reservations.length ? data.reservations.map(reservation => <div key={reservation.id} className={styles.record}>
        <div className={styles.recordHeading}><h4 className={styles.recordTitle}>{reservation.unitNumber ? `Unidad ${reservation.unitNumber}` : 'Unidad de la solicitud'}</h4>
          <span className={styles.recordDate}>{reservation.requestedAt ? formatAgendaDateTime(reservation.requestedAt) : 'Fecha sin registrar'}</span></div>
        <p className={styles.detail}>{reservation.status === 'requested' ? 'Solicitud de gestión recibida por el equipo' : reservation.status}</p>
      </div>) : <p className={styles.empty}>{data.pipeline.coverage.reservations === false ? 'No se pudieron comprobar las solicitudes de reserva. Reintente la carga.' : 'No hay solicitudes de reserva registradas. Preguntar condiciones no inicia una reserva.'}</p>}
      {!!data.reservations.length && <p className={styles.detail}>Fuente: solicitudes operativas de reserva. Una solicitud no demuestra reserva confirmada, pago ni bloqueo de inventario.</p>}
    </Section>
    <Section title="Showroom y recorrido" icon={<Building2 size={15} />}>
      <p className={styles.empty}>El recorrido y las consultas de espacios se revisan en las pestañas del lead. Un espacio visto o vinculado no equivale a una unidad elegida.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onOpenShowroom && <button type="button" className={styles.refresh} onClick={onOpenShowroom}>Ver showroom</button>}
        {onOpenTour && <button type="button" className={styles.refresh} onClick={onOpenTour}>Ver recorrido 360°</button>}
      </div>
    </Section>
    <Section title="Seguimiento registrado" icon={<Sprout size={15} />}>
      {data.jobs.length ? data.jobs.map(job => <div key={job.id} className={styles.record}>
        <div className={styles.recordHeading}><h4 className={styles.recordTitle}>{jobNames[job.task] || 'Seguimiento del lead'}</h4>
          <span className={styles.recordDate}>{jobStatuses[job.status] || job.status}</span></div>
        <p className={styles.detail}>{job.scheduledAt ? formatAgendaDateTime(job.scheduledAt) : 'Sin fecha registrada'}</p>
      </div>) : <p className={styles.empty}>{data.pipeline.coverage.jobs === false ? 'No se pudieron comprobar los seguimientos programados. Reintente la carga.' : 'No hay tareas de envío registradas en esta vista. Una próxima acción anotada no programa por sí sola un mensaje.'}</p>}
      {!!data.jobs.length && <p className={styles.detail}>Tareas reales de seguimiento. Su envío depende de que sigan cumpliéndose las condiciones de contacto.</p>}
    </Section>
  </>
}

function MetadataForm({ initial, enabled, disabledMessage, onSaved }: { initial: LeadPipelineMetadataInput; enabled: boolean; disabledMessage?: string; onSaved: () => Promise<void> }) {
  const id = useId()
  const [nutritionActive, setNutritionActive] = useState(initial.nutritionActive)
  const [opportunityStatus, setOpportunityStatus] = useState(initial.opportunityStatus)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  return <details className={`${styles.section} ${styles.disclosure}`}>
    <summary>Actualizar nutrición, próxima acción o cierre</summary>
    <form className={styles.form} onSubmit={async event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const value = (key: string) => String(form.get(key) || '').trim()
      const nextActionAt = value('nextActionAt'), resumeAt = value('resumeAt')
      setSaving(true); setMessage(''); setFailed(false)
      try {
        const result = await updateLeadPipelineMetadataAction({ leadId: initial.leadId, nutritionActive,
          nutritionReason: value('nutritionReason'), purchaseHorizon: value('purchaseHorizon'),
          nutritionEvidence: value('nutritionEvidence'), contactConsent: form.get('contactConsent') === 'on',
          resumeAt: resumeAt ? datetimeLocalToIso(resumeAt) || null : null,
          nextAction: value('nextAction'), nextActionAt: nextActionAt ? datetimeLocalToIso(nextActionAt) || null : null,
          opportunityStatus, closureReason: value('closureReason') })
        if (!result.ok) throw new Error(result.error)
        await onSaved()
      } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'No se pudo guardar la gestión.') }
      finally { setSaving(false) }
    }}>
      {!enabled && <p className={styles.notice}>{disabledMessage || 'La actualización de la gestión todavía no está disponible para este registro.'}</p>}
      <fieldset disabled={!enabled || saving} className="contents">
        <label className={styles.formLabel} htmlFor={`${id}-nutrition`}>Nutrición
          <select id={`${id}-nutrition`} name="nutritionActive" className={styles.input} value={nutritionActive ? 'yes' : 'no'} onChange={event => setNutritionActive(event.target.value === 'yes')}>
            <option value="no">NO — sin pausa de compra registrada</option><option value="yes">SÍ — compra futura con contacto acordado</option>
          </select>
        </label>
        <p className={styles.help}>Active la nutrición solo con interés futuro expresado por el lead y un acuerdo para volver a contactarlo. El silencio o un saludo no bastan.</p>
        <label className={styles.formLabel} htmlFor={`${id}-reason`}>Motivo de la pausa
          <textarea id={`${id}-reason`} name="nutritionReason" className={`${styles.input} ${styles.textarea}`} required={nutritionActive} maxLength={1000} defaultValue={initial.nutritionReason} />
        </label>
        <label className={styles.formLabel} htmlFor={`${id}-horizon`}>Plazo o condición de compra futura
          <input id={`${id}-horizon`} name="purchaseHorizon" className={styles.input} required={nutritionActive} maxLength={500} defaultValue={initial.purchaseHorizon} placeholder="Por ejemplo: al regresar al país o en tres meses" />
        </label>
        <label className={styles.formLabel} htmlFor={`${id}-evidence`}>Declaración del lead y acuerdo de contacto
          <textarea id={`${id}-evidence`} name="nutritionEvidence" className={`${styles.input} ${styles.textarea}`} required={nutritionActive} maxLength={1500} defaultValue={initial.nutritionEvidence} placeholder="Conserve lo que indicó y cuándo aceptó que le contactemos." />
        </label>
        <label className={styles.checkboxLabel}><input name="contactConsent" type="checkbox" required={nutritionActive} defaultChecked={initial.contactConsent} />Existe un acuerdo de contacto expresado por el lead.</label>
        <label className={styles.formLabel} htmlFor={`${id}-resume`}>Fecha acordada de retoma, si corresponde · hora de Ecuador
          <input id={`${id}-resume`} name="resumeAt" type="datetime-local" className={styles.input} defaultValue={isoToDatetimeLocal(initial.resumeAt)} />
        </label>
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor={`${id}-action`}>Próxima acción del equipo
            <input id={`${id}-action`} name="nextAction" className={styles.input} maxLength={1000} defaultValue={initial.nextAction} placeholder="Por ejemplo: verificar una condición y responder" />
          </label>
          <label className={styles.formLabel} htmlFor={`${id}-action-date`}>Fecha de gestión · hora de Ecuador
            <input id={`${id}-action-date`} name="nextActionAt" type="datetime-local" className={styles.input} defaultValue={isoToDatetimeLocal(initial.nextActionAt)} />
          </label>
        </div>
        <p className={styles.help}>Esta próxima acción queda anotada para el equipo. No activa un envío automático ni cambia el calendario del bot.</p>
        <label className={styles.formLabel} htmlFor={`${id}-outcome`}>Situación de la oportunidad
          <select id={`${id}-outcome`} className={styles.input} value={opportunityStatus} onChange={event => {
            const next = event.target.value as 'open' | 'lost'
            setOpportunityStatus(next)
            if (next === 'lost') setNutritionActive(false)
          }}>
            <option value="open">Abierta</option><option value="lost">Cerrada sin venta</option>
          </select>
        </label>
        <label className={styles.formLabel} htmlFor={`${id}-closure`}>Motivo del cierre
          <textarea id={`${id}-closure`} name="closureReason" className={`${styles.input} ${styles.textarea}`} required={opportunityStatus === 'lost'} maxLength={1000} defaultValue={initial.closureReason} />
        </label>
        <p className={styles.help}>La reserva y la venta se acreditan en sus gestiones operativas. Esta ficha no permite confirmarlas manualmente.</p>
        <button type="submit" disabled={!enabled || saving} className={styles.submit}>{saving ? 'Guardando…' : 'Guardar gestión comercial'}</button>
      </fieldset>
      {message && <p role={failed ? 'alert' : 'status'} className={`${styles.status} ${failed ? styles.failure : ''}`}>{message}</p>}
    </form>
  </details>
}

export function LeadCommercialProfilePanel(props: PanelProps) {
  return <LeadCommercialProfileContent key={props.leadId} {...props} />
}

function LeadCommercialProfileContent({ leadId, onUpdated, onOpenAgenda, onOpenShowroom, onOpenTour, initialData, onDataChanged }: PanelProps) {
  const { canWrite, isLoading: roleLoading } = useRoleAccess()
  const [data, setData] = useState<LeadPipelineDetail | null>(initialData || null)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const initialDataRef = useRef(initialData)

  useEffect(() => {
    if (initialDataRef.current && revision === 0) return
    let current = true
    getLeadPipelineDetailAction(leadId).then(result => {
      if (!current) return
      if (!result.ok) { setError(result.error); return }
      setData(result.data)
      onDataChanged?.(result.data)
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la ficha comercial.')
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [leadId, revision, onDataChanged])

  const refresh = () => {
    setLoading(true); setError(''); setData(null); setSaveNotice('')
    setRevision(value => value + 1)
  }

  if (loading) return <div className={styles.loading} role="status"><Loader2 size={17} className="animate-spin" />Cargando ficha comercial…</div>
  if (!data) return <div className={styles.error} role="alert">
    <p>{error || 'No se pudo cargar la ficha comercial.'}</p>
    <button type="button" className={`${styles.refresh} mt-3`} onClick={refresh}>Volver a intentar</button>
  </div>

  const pipeline = data.pipeline
  const metadataKey = JSON.stringify(data.metadata)
  const warnings = [...new Set([...pipeline.warnings, ...data.warnings])]
  return <div className={styles.panel}>
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>Avance y atención del lead</p><h2 className={styles.title}>Ficha comercial</h2>
        <p className={styles.intro}>Información declarada, gestiones comprobadas y el siguiente paso de atención.</p></div>
      <button type="button" className={styles.refresh} onClick={refresh}><RefreshCw size={12} />Actualizar</button>
    </div>

    <div className={styles.summary}>
      <section className={`${styles.summaryCard} ${styles.stageCard}`}>
        <h3 className={styles.label}>Etapa comercial</h3><p className={styles.value}>{pipeline.stageLabel}</p>
        {pipeline.stageProvisional && <p className={styles.detail}>Clasificación provisional: hay fuentes por comprobar.</p>}
        <p className={styles.detail}>{pipeline.stageReason}</p>
        {pipeline.stageChangedAt && <p className={styles.detail}>Desde {formatAgendaDateTime(pipeline.stageChangedAt)}</p>}
      </section>
      <section className={styles.summaryCard}>
        <h3 className={styles.label}>Nutrición</h3>
        <p><span className={`${styles.badge} ${!pipeline.nutritionActive ? styles.mutedBadge : ''}`}>{pipeline.nutritionKnown === false ? 'POR VERIFICAR' : pipeline.nutritionActive ? 'SÍ · compra futura' : 'NO'}</span></p>
        <p className={styles.detail}>{pipeline.nutritionKnown === false ? 'No se pudo comprobar toda la información de nutrición.' : pipeline.nutritionActive ? pipeline.nutritionReason || 'Compra futura con contacto acordado.'
          : 'Sin pausa activa de compra futura con contacto acordado.'}</p>
        {pipeline.purchaseHorizon && <p className={styles.detail}>Plazo o condición: {pipeline.purchaseHorizon}</p>}
        {pipeline.resumeAt && <p className={styles.detail}>Retoma acordada: {formatAgendaDateTime(pipeline.resumeAt)}</p>}
        {!pipeline.resumeAt && pipeline.resumeCondition && <p className={styles.detail}>Retomar cuando: {pipeline.resumeCondition}</p>}
      </section>
      <section className={styles.summaryCard}>
        <h3 className={styles.label}>Atención</h3><p className={styles.value}>{pipeline.attentionLabel}</p>
        <p className={styles.detail}>{pipeline.lastCustomerAt ? `Último mensaje del lead: ${formatAgendaDateTime(pipeline.lastCustomerAt)}` : 'Sin mensaje del lead registrado en esta vista.'}</p>
        {pipeline.lastResponseAt && <p className={styles.detail}>Última respuesta: {formatAgendaDateTime(pipeline.lastResponseAt)}</p>}
      </section>
      <section className={styles.summaryCard}>
        <h3 className={styles.label}>Próxima acción</h3><p className={styles.value}>{nextActionDescription(pipeline)}</p>
        {pipeline.nextActionAt && <p className={styles.detail}>{formatAgendaDateTime(pipeline.nextActionAt)}</p>}
        <p className={styles.detail}>{pipeline.nextActionScheduled ? 'Existe una tarea de seguimiento registrada.' : 'Anotación de gestión; no programa un mensaje automático.'}</p>
      </section>
    </div>

    {pipeline.opportunityStatus !== 'open' && <div className={styles.notice}>
      <strong>{pipeline.opportunityStatus === 'won' ? 'Venta cerrada con registro operativo.' : 'Oportunidad cerrada sin venta.'}</strong>
      {pipeline.closureReason && <p className="mt-1">{pipeline.closureReason}</p>}
    </div>}
    <LeadPipelineWarnings warnings={warnings} issues={data.issues || pipeline.issues} onRetry={refresh} loading={loading} />

    <MetadataForm key={metadataKey} initial={data.metadata} enabled={canWrite && data.canEdit !== false && !roleLoading && data.metadataAvailable && pipeline.coverage.conversations !== false && pipeline.opportunityStatus !== 'won'}
      disabledMessage={roleLoading ? 'Consultando sus permisos de edición.' : !canWrite || data.canEdit === false ? 'Su acceso permite consultar esta ficha, pero no editar la gestión comercial.'
        : pipeline.coverage.conversations === false ? 'No se pudo comprobar el contexto de la conversación. Reintente antes de actualizar la gestión.'
        : pipeline.opportunityStatus === 'won' ? 'La venta ya está cerrada. Sus cambios se gestionan desde el registro operativo correspondiente.' : undefined}
      onSaved={async () => {
      const refreshed = await getLeadPipelineDetailAction(leadId)
      if (!refreshed.ok) throw new Error('La gestión se guardó, pero no se pudo actualizar la ficha. Pulse Actualizar para comprobarla.')
      setData(refreshed.data)
      onDataChanged?.(refreshed.data)
      setSaveNotice('Gestión actualizada. No se enviaron mensajes ni se creó una cita o reserva.')
      onUpdated()
    }} />
    {saveNotice && <p role="status" className={styles.notice}>{saveNotice}</p>}

    {data.groups.map(group => <Section key={group.title} title={group.title} icon={<ClipboardList size={15} />}>
      <Fields values={group.fields.map(field => [field.label, field.value])} />
    </Section>)}

    <ProcessSections data={data} onOpenAgenda={onOpenAgenda} onOpenShowroom={onOpenShowroom} onOpenTour={onOpenTour} />

    <Section title="Motivo y fuentes de la etapa" icon={<ClipboardList size={15} />}>
      {pipeline.evidence.length ? pipeline.evidence.map((evidence, index) => <div key={`${evidence.sourceId || evidence.source}:${index}`} className={styles.record}>
        <p className={styles.recordTitle}>{evidence.reason}</p>
        <p className={styles.detail}>{sourceNames[evidence.source] || evidence.source}{evidence.at ? ` · ${formatAgendaDateTime(evidence.at)}` : ''}</p>
      </div>) : <p className={styles.empty}>Todavía no existe evidencia suficiente para acreditar un avance adicional.</p>}
    </Section>
    <Section title="Historial de cambios comerciales" icon={<History size={15} />}>
      {data.history.length ? [...data.history].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).map(entry => <div key={entry.id} className={styles.record}>
        <div className={styles.recordHeading}><h4 className={styles.recordTitle}>{entry.fromStage && entry.toStage ? `${stageName(entry.fromStage)} → ${stageName(entry.toStage)}` : entry.toStage ? stageName(entry.toStage) : 'Actualización de gestión'}</h4>
          <span className={styles.recordDate}>{formatAgendaDateTime(entry.at)}</span></div>
        <p className={styles.detail}>{entry.reason}</p>
        {entry.actor && <p className={styles.detail}>Responsable del cambio: {actorName(entry.actor)}</p>}
      </div>) : <p className={styles.empty}>{pipeline.coverage.history === false || pipeline.coverage.profile_history === false ? 'No se pudo comprobar todo el historial comercial. Reintente la carga.' : 'No hay cambios comerciales documentados en esta vista. El historial de conversación permanece en su pestaña.'}</p>}
    </Section>
  </div>
}
