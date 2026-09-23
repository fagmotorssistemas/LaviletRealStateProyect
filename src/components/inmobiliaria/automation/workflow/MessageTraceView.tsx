'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronRight, RefreshCw, Search } from 'lucide-react'
import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'
import { conversationGroups, explainStep, humanValue, statusLabel, stepTitle, type ExplanationFact } from './messageExplanation'
import styles from './MessageTraceView.module.css'

export function MessageTraceView() {
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'conversations' | 'maintenance'>('conversations')
  const [groupId, setGroupId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [stepOrder, setStepOrder] = useState<number | null>(null)
  const pendingRequest = useRef<AbortController | null>(null)
  const panel = useRef<HTMLElement>(null)
  const load = useCallback(async (cursor?: string, background = false) => {
    if (background && pendingRequest.current) return
    pendingRequest.current?.abort()
    const controller = new AbortController()
    pendingRequest.current = controller
    if (!background) setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ view })
      if (view === 'conversations' && query.trim()) params.set('q', query.trim())
      if (cursor) params.set('cursor', cursor)
      const response = await fetch(`/api/integrations/automation/workflow?${params}`, { cache: 'no-store', signal: controller.signal })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'No se pudo leer la bitácora')
      if (controller.signal.aborted) return
      const incoming: WorkflowExecution[] = Array.isArray(body.executions) ? body.executions : []
      setExecutions(previous => {
        const merged = [...new Map([...previous, ...incoming].map(item => [item.id, item])).values()]
        return merged.sort((a, b) => (b.receivedAt || b.occurredAt).localeCompare(a.receivedAt || a.occurredAt) || b.id.localeCompare(a.id))
      })
      if (!background) setNextCursor(typeof body.nextCursor === 'string' ? body.nextCursor : null)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'No se pudo leer la bitácora')
    } finally { if (pendingRequest.current === controller) { pendingRequest.current = null; setLoading(false) } }
  }, [query, view])
  useEffect(() => {
    const timer = setTimeout(() => void load(), 300)
    return () => { clearTimeout(timer); pendingRequest.current?.abort() }
  }, [load])
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(undefined, true) }, 5000)
    return () => clearInterval(timer)
  }, [load])
  const resetResults = () => {
    pendingRequest.current?.abort()
    setExecutions([]); setNextCursor(null); setGroupId(''); setBatchId(''); setStepOrder(null); setError(''); setLoading(true)
  }
  const groups = useMemo(() => conversationGroups(executions), [executions])
  const group = groups.find(item => item.id === groupId) || groups[0]
  const batch = group?.batches.find(item => item.id === batchId || item.members.some(member => member.id === batchId)) || group?.batches[0]
  const execution = batch?.execution
  const steps = useMemo(() => [...(execution?.steps || [])].sort((a, b) => a.order - b.order), [execution])
  const step = steps.find(item => item.order === stepOrder) || steps.find(item => item.key === 'dialogue_decision') || steps[0]
  const explanation = execution && step ? explainStep(execution, step) : null
  const processing = execution && ['pending', 'processing'].includes(execution.status)
  useEffect(() => {
    if (group && !groupId) setGroupId(group.id)
    if (batch && !batchId) setBatchId(batch.members[0].id)
  }, [group, batch, groupId, batchId])
  const handoffs = steps.filter(item => item.key === 'advisor_handoff')
  const selectStep = (order: number) => { setStepOrder(order); panel.current?.focus() }

  return <section className={styles.trace} aria-label="Mensajes y decisiones reales">
    <header className={styles.toolbar}>
      <div><h2>Mensajes y decisiones</h2><p>Registros de ejecución. Los resúmenes protegen datos personales y pueden estar abreviados.</p></div>
      <button type="button" className={styles.button} onClick={() => void load()} disabled={loading}><RefreshCw size={14} />{loading ? 'Cargando…' : 'Actualizar'}</button>
    </header>
    <nav className={styles.views} aria-label="Tipo de ejecuciones">
      <button type="button" className={styles.button} aria-pressed={view === 'conversations'} onClick={() => { if (view !== 'conversations') { resetResults(); setView('conversations'); setQuery('') } }}>Conversaciones</button>
      <button type="button" className={styles.button} aria-pressed={view === 'maintenance'} onClick={() => { if (view !== 'maintenance') { resetResults(); setView('maintenance'); setQuery('') } }}>Mantenimiento</button>
    </nav>
    {view === 'maintenance' && <p className={styles.maintenanceNote}>Tareas programadas del sistema, como revisión de visitas y seguimientos. Una ejecución completada no significa que se haya enviado un mensaje.</p>}
    <div className={styles.filters}>
      {view === 'conversations' && <label><span>Buscar lead en todo el historial</span><div className={styles.search}><Search size={15} /><input value={query} maxLength={100} onChange={event => { resetResults(); setQuery(event.target.value) }} placeholder="Nombre del lead o ID de Kommo" /></div></label>}
      <label><span>Conversación</span><select aria-label="Conversación" value={group?.id || ''} onChange={event => { setGroupId(event.target.value); setBatchId(''); setStepOrder(null) }} disabled={!groups.length}>
        {!groups.length && <option value="">Sin registros</option>}
        {groups.map((item, index) => <option value={item.id} key={item.id}>{item.label} · {item.id.startsWith('lead:') ? 'Historial del lead' : item.known ? `Conversación ${index + 1}` : 'Conversación no identificada'} · {item.batches.length} mensajes o lotes</option>)}
      </select></label>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!execution ? <div className={styles.empty} role="status">{loading ? 'Buscando ejecuciones…' : query ? 'No se encontraron conversaciones para ese lead. Pruebe con parte del nombre o su ID de Kommo.' : view === 'maintenance' ? 'No hay tareas de mantenimiento registradas.' : 'Todavía no hay conversaciones disponibles para sus proyectos.'}</div>
      : <div className={styles.layout}>
        <nav className={styles.messages} aria-label="Mensajes de la conversación">
          <h3>{group?.label}</h3>
          {!group?.known && <p className={styles.muted}>No se guardó el identificador de conversación. Este evento se muestra por separado.</p>}
          {group?.batches.map(item => <button type="button" key={item.id} className={styles.message} aria-pressed={item.id === batch?.id}
            onClick={() => { setBatchId(item.members[0].id); setStepOrder(null) }}>
            <time>{formatDate(item.execution.receivedAt || item.execution.occurredAt)}</time>
            <strong>{item.execution.message || (item.execution.kind === 'maintenance' ? 'Tarea automática' : 'Mensaje sin vista previa')}</strong>
            <span>{item.execution.outcome}</span>
            <small>{item.total > 1 ? `Lote de ${item.total} mensajes` : 'Un mensaje'} · {item.execution.steps.length ? `${item.execution.steps.length} pasos registrados` : 'Sin pasos registrados'}</small>
          </button>)}
        </nav>
        <div className={styles.main}>
          <header className={styles.messageHeading}>
            <div><span className={styles.eyebrow}>{batch && batch.total > 1 ? 'Mensajes procesados juntos' : 'Mensaje seleccionado'} · {formatDate(execution.receivedAt || execution.occurredAt)}</span>
              <h3>{execution.leadName}</h3></div>
            <span className={styles.badge} data-tone={execution.traceAvailable ? 'observed' : 'missing'}>{processing ? execution.outcome : execution.traceAvailable ? 'Pasos registrados' : 'Evidencia incompleta'}</span>
          </header>
          <div className={styles.messageContent}>{batch?.members.map(member => <blockquote key={member.id}>{member.message || 'El contenido del mensaje no está disponible en esta bitácora.'}</blockquote>)}</div>
          {batch && batch.total > batch.members.length && <p className={styles.notice}>El registro indica {batch.total} mensajes en este lote; hay {batch.members.length} vistas previas cargadas. Los pasos son compartidos, no una ejecución independiente por cada mensaje.</p>}
          {batch && batch.total > 1 && batch.total === batch.members.length && <p className={styles.muted}>Estos mensajes pertenecen al mismo lote registrado y comparten el recorrido.</p>}
          <p className={styles.outcome}>{execution.outcome}{execution.action === 'accepted' ? ' · Entrega y lectura en WhatsApp sin confirmar.' : ''}</p>
          {processing && <p className={styles.notice} role="status">{execution.status === 'pending' ? 'Mensaje recibido: esperando procesamiento.' : 'Procesando la respuesta.'} La vista se actualiza cada 5 segundos. Puede revisar los mensajes anteriores mientras espera.</p>}
          {!steps.length && processing ? <p className={styles.muted}>Los pasos aparecerán cuando se guarde la ejecución.</p> : !steps.length ? <div className={styles.empty}>
            <h4>{execution.traceWarning === 'AUDIT_READ_FAILED' ? 'No se pudo leer la bitácora' : 'No hay pasos registrados para este evento'}</h4>
            <p>El resultado disponible no permite reconstruir qué interpretó el bot, qué datos consultó ni por qué tomó una decisión. La ruta histórica sería inferida y no se presenta como observada.</p>
          </div> : <>
            <ol className={styles.steps} aria-label="Pasos observados de este mensaje">{steps.map(item => <li key={item.order}>
              <button type="button" aria-pressed={item.order === step?.order} onClick={() => setStepOrder(item.order)} data-status={item.status} data-ai={item.key === 'model_request'}>
                <span className={styles.stepNumber}>{item.order.toString().padStart(2, '0')}</span><span><strong>{stepTitle(item)}</strong><small>{statusLabel(item.status)} · {duration(item.durationMs)}</small></span><ChevronRight size={14} />
              </button>
            </li>)}</ol>
            {explanation && step && <section className={styles.detail} ref={panel} tabIndex={-1} aria-label="Explicación del paso seleccionado" aria-live="polite">
              <header><div><span className={styles.eyebrow}>Paso {step.order} · {statusLabel(step.status)}</span><h4>{explanation.title}</h4></div><span className={styles.badge} data-tone="observed">Observado en el registro</span></header>
              <p className={styles.summary}>{explanation.summary}</p>
              {step.key === 'model_request' && <AIExchange step={step} onCause={explanation.cause ? () => selectStep(explanation.cause!.order) : undefined} />}
              <FactSection title="Qué información utilizó" facts={explanation.used} empty="No se guardaron entradas legibles para este paso." />
              {explanation.coverageSections ? explanation.coverageSections.map(section => <FactSection key={section.title} title={section.title} description={section.description} facts={section.facts} empty="No se guardaron datos para esta sección." />)
                : <FactSection title="Qué encontró" facts={explanation.found} empty="No se guardaron resultados detallados para este paso." />}
              {explanation.units.length > 0 && <div className={styles.units}><table><caption>Unidades según la instantánea de esta ejecución</caption><thead><tr><th>Unidad</th><th>Dormitorios</th><th>Planta</th><th>Interior</th><th>Exterior</th></tr></thead><tbody>
                {explanation.units.map(unit => <tr key={unit.id}><th scope="row">{unit.category || 'Unidad'} {unit.unit_number}</th><td>{measurement(unit.bedrooms)}</td><td>{measurement(unit.floor_number)}</td><td>{measurement(unit.area_internal_m2, ' m²')}</td><td>{measurement(unit.area_exterior_m2, ' m²')}</td></tr>)}
              </tbody></table></div>}
              <div className={styles.decision}><h5>{explanation.coverageSections ? '¿Necesita un asesor? Motivo de la decisión' : 'Qué decidió y por qué'}</h5>
                {explanation.coverageSections && <p>El motivo siguiente explica la derivación a un asesor, no el descarte del borrador. El motivo del descarte se muestra en «Error detectado».</p>}<dl>
                <div><dt>Origen</dt><dd>{explanation.origin}</dd></div><div><dt>Motivo registrado</dt><dd>{explanation.reason}</dd></div>
                <div><dt>Regla registrada</dt><dd>{explanation.rule}</dd></div><div><dt>Resultado</dt><dd>{explanation.outcome}</dd></div>
              </dl></div>
              {explanation.cause ? <button className={styles.cause} type="button" onClick={() => selectStep(explanation.cause!.order)}>Ver el paso causante registrado: {explanation.cause.order}. {stepTitle(explanation.cause)}<ArrowRight size={15} /></button>
                : (explanation.missingCause || step.key === 'advisor_handoff') && <p className={styles.notice}>{explanation.missingCause ? 'El paso causante está referenciado, pero no está disponible en esta ejecución.' : 'No se registró un vínculo al paso causante. La causa no se deduce de la cercanía entre nodos.'}</p>}
              {explanation.linkedActions.map(action => <button className={styles.cause} key={action.order} type="button" onClick={() => selectStep(action.order)}>Ver derivación vinculada a esta decisión: paso {action.order}<ArrowRight size={15} /></button>)}
              <div className={styles.review}><strong>Qué revisar</strong><p>{explanation.review}</p>{explanation.setting ? <p>{explanation.setting.kind}: {explanation.setting.href
                ? <Link href={explanation.setting.href}>{explanation.setting.label}<ArrowRight size={13} /></Link> : explanation.setting.label}</p> : <p>No se registró un ajuste editable responsable de este paso.</p>}{explanation.setting?.source && <p>Módulo responsable: <code>{explanation.setting.source}</code></p>}</div>
              {step.key !== 'advisor_handoff' && <div className={styles.related}><strong>Derivaciones de esta ejecución</strong>{handoffs.length ? <><p>Estos enlaces muestran registros de acción; solo un vínculo causal explícito demuestra su relación con el paso seleccionado.</p>{handoffs.map(action => <button className={styles.button} key={action.order} type="button" onClick={() => selectStep(action.order)}>Paso {action.order}: {statusLabel(action.status)}<ArrowRight size={13} /></button>)}</> : <p>No hay un paso de derivación registrado. El texto de una respuesta no basta para confirmar que se ejecutó.</p>}</div>}
              <details className={styles.technical}><summary>Ver detalles técnicos de este paso</summary><pre>{JSON.stringify({ order: step.order, key: step.key, source: step.source, status: step.status, durationMs: step.durationMs, input: step.input, output: step.output, errorCode: step.errorCode }, null, 2)}</pre></details>
            </section>}
          </>}
          <details className={styles.technical}><summary>Identidad, versiones y alcance del registro</summary><p>Son resúmenes declarados por el sistema, no una captura completa de cada consulta o de todo lo recibido por el modelo.</p><pre>{JSON.stringify({ eventIds: batch?.members.map(item => item.id), conversationId: execution.conversationId || null, batchId: execution.batchId || null, batchEventIds: execution.batchEventIds || [], traceSource: execution.traceSource, traceWarning: execution.traceWarning, stopReason: execution.stopReason, versions: execution.versions }, null, 2)}</pre></details>
        </div>
      </div>}
    <footer className={styles.footer}><span>{executions.length} {view === 'maintenance' ? 'tareas cargadas' : 'registros de conversación cargados'}{query.trim() ? ` para «${query.trim()}»` : ''} · La búsqueda se aplica a todo el historial.</span>{nextCursor && <button type="button" className={styles.button} disabled={loading} onClick={() => void load(nextCursor)}>{view === 'maintenance' ? 'Cargar tareas anteriores' : 'Cargar mensajes anteriores'}</button>}</footer>
  </section>
}

function AIExchange({ step, onCause }: { step: WorkflowExecutionStep; onCause?: () => void }) {
  const snapshot = (step.input.prompt_snapshot || {}) as Record<string, unknown>
  const output = (step.output.output_snapshot || {}) as Record<string, unknown>
  return <div className={styles.aiExchange}>
    <h5>Entrada y salida de esta llamada a IA</h5>
    <p>Modelo: {String(step.input.model || 'No registrado')}. Copia protegida: puede ocultar datos sensibles.</p>
    {!!(snapshot.limited || output.limited) && <p className={styles.notice}>Parte del contenido supera el límite de captura y está abreviado.</p>}
    {!!step.input.attachments_omitted && <p>Se envió un archivo o imagen. Su contenido binario no se conserva aquí.</p>}
    <details className={styles.technical}><summary>1. Entrada · instrucciones, mensaje e historial</summary>
      {step.input.prompt_snapshot ? <>
        <h5>Instrucciones compuestas</h5><pre>{String(snapshot.instructions || '')}</pre>
        <h5>Datos enviados</h5><p>{String(snapshot.user_prefix || '')}</p><pre>{JSON.stringify(snapshot.data, null, 2)}</pre>
        <h5>Formato exigido</h5><pre>{JSON.stringify(snapshot.response_schema, null, 2)}</pre>
      </> : <p>Esta ejecución no conservó la entrada. No se reconstruye a partir del hash del prompt.</p>}
    </details>
    <details className={styles.technical} open><summary>2. Salida · resultado devuelto por la IA</summary>
      {step.output.output_snapshot ? <pre>{JSON.stringify(output.data, null, 2)}</pre> : <p>No se conservó una salida estructurada. Puede ser un registro antiguo o una llamada que falló antes de obtener un JSON válido.</p>}
    </details>
    <h5>3. Uso del resultado por el sistema</h5>
    <p>Una llamada completada no significa que su propuesta se haya enviado al lead. Consulte la aceptación, corrección o descarte en el paso que utiliza este resultado.</p>
    {onCause ? <button type="button" className={styles.cause} onClick={onCause}>Ver decisión del paso que solicitó esta llamada<ArrowRight size={15} /></button> : <p>No hay un paso responsable vinculado disponible; no se puede determinar su decisión desde este nodo.</p>}
  </div>
}

function FactSection({ title, facts, empty, description }: { title: string; facts: ExplanationFact[]; empty: string; description?: string }) {
  return <div className={styles.facts}><h5>{title}</h5>{description && <p>{description}</p>}{facts.length ? <dl>{facts.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : <p className={styles.muted}>{empty}</p>}</div>
}
function measurement(value: unknown, suffix = '') { return typeof value === 'number' && Number.isFinite(value) ? humanValue(value) + suffix : 'No registrado' }
function duration(value: number) { return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s` }
function formatDate(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-EC', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Guayaquil' }).format(date) : 'Sin fecha registrada'
}
