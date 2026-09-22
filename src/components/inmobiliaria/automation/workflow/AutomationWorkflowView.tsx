'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Bot,
  BrainCircuit,
  Check,
  CircleStop,
  GitBranch,
  Inbox,
  Info,
  LockKeyhole,
  MousePointer2,
  Play,
  RefreshCw,
  Route,
  Search,
  Sparkles,
} from 'lucide-react'
import { AutomationSectionTabs } from '@/components/inmobiliaria/automation/AutomationSectionTabs'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import {
  WORKFLOWS,
  WORKFLOW_ORDER,
  type WorkflowId,
  type WorkflowNode,
  type WorkflowNodeData,
  type WorkflowNodeKind,
} from './workflowDefinitions'
import {
  displayValue,
  fieldLabel,
  workflowFromExecution,
  type WorkflowExecution,
} from './executionWorkflow'
import styles from './AutomationWorkflowView.module.css'

const KIND_LABEL: Record<WorkflowNodeKind, string> = {
  input: 'Entrada', process: 'Proceso', decision: 'Decisión', ai: 'IA', action: 'Acción', pause: 'Pausa', success: 'Resultado',
}

const KIND_ICON = {
  input: Inbox,
  process: Route,
  decision: GitBranch,
  ai: BrainCircuit,
  action: Sparkles,
  pause: CircleStop,
  success: Check,
} satisfies Record<WorkflowNodeKind, typeof Inbox>

function FlowNode({ data, selected }: NodeProps<WorkflowNode>) {
  const Icon = KIND_ICON[data.kind]
  return <div className={styles.node} data-kind={data.kind} data-selected={selected ? 'true' : 'false'} data-trace={data.trace === true ? 'true' : undefined}>
    <Handle type="target" position={Position.Left} className={styles.handle} />
    <div className={styles.nodeTop}>
      <span className={styles.nodeIcon}><Icon size={14} /></span>
      <span>{data.eyebrow}</span>
    </div>
    <strong>{data.title}</strong>
    <p>{data.summary}</p>
    {data.traceStatus && <div className={styles.nodeTraceMeta}>
      <span data-status={data.traceStatus}>{traceStatusLabel(data.traceStatus)}</span>
      <time>{formatDuration(data.durationMs)}</time>
    </div>}
    <Handle type="source" position={Position.Right} className={styles.handle} />
  </div>
}

const nodeTypes: NodeTypes = { workflow: FlowNode }

export function AutomationWorkflowView() {
  const { isAdmin } = useRoleAccess()
  const [workflowId, setWorkflowId] = useState<WorkflowId>('overview')
  const [selectedId, setSelectedId] = useState(WORKFLOWS.overview.nodes[0].id)
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null)
  const [executionsLoading, setExecutionsLoading] = useState(false)
  const [executionsError, setExecutionsError] = useState('')
  const [executionQuery, setExecutionQuery] = useState('')
  const [executionStatus, setExecutionStatus] = useState('all')
  const [executionDate, setExecutionDate] = useState('')
  const selectedExecution = executions.find(item => item.id === selectedExecutionId) ?? null
  const liveDefinition = useMemo(() => selectedExecution ? workflowFromExecution(selectedExecution) : null, [selectedExecution])
  const definition = liveDefinition ?? WORKFLOWS[workflowId]

  const loadExecutions = useCallback(async () => {
    if (!isAdmin) return
    setExecutionsLoading(true)
    setExecutionsError('')
    try {
      const response = await fetch('/api/integrations/automation/workflow', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'No se pudieron cargar las ejecuciones')
      setExecutions(Array.isArray(body.executions) ? body.executions : [])
    } catch (error) {
      setExecutionsError(error instanceof Error ? error.message : 'No se pudieron cargar las ejecuciones')
    } finally {
      setExecutionsLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { void loadExecutions() }, [loadExecutions])

  const tracedPath = useMemo(() => !liveDefinition && selectedExecution?.workflowId === workflowId
    ? selectedExecution.path : [], [liveDefinition, selectedExecution, workflowId])
  const nodes = useMemo(() => definition.nodes.map(item => ({
    ...item,
    data: { ...item.data, trace: tracedPath.includes(item.id) },
    selected: item.id === selectedId,
  })), [definition, selectedId, tracedPath])
  const edges = useMemo(() => definition.edges.map(item => ({
    ...item,
    animated: Boolean(liveDefinition) || (tracedPath.includes(item.source) && tracedPath.includes(item.target)),
    markerEnd: { type: MarkerType.ArrowClosed, color: liveDefinition || (tracedPath.includes(item.source) && tracedPath.includes(item.target)) ? '#4e8061' : '#829077' },
    style: { stroke: liveDefinition || (tracedPath.includes(item.source) && tracedPath.includes(item.target)) ? '#4e8061' : '#829077', strokeWidth: liveDefinition || (tracedPath.includes(item.source) && tracedPath.includes(item.target)) ? 2.5 : 1.6 },
    labelStyle: { fill: '#65705f', fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: '#fbfcf8', fillOpacity: .92 },
    labelBgPadding: [5, 3] as [number, number],
    labelBgBorderRadius: 3,
  })), [definition, liveDefinition, tracedPath])
  const selected = definition.nodes.find(item => item.id === selectedId) ?? definition.nodes[0]
  const filteredExecutions = useMemo(() => executions.filter(execution => {
    const query = executionQuery.trim().toLocaleLowerCase('es')
    const matchesQuery = !query || `${execution.leadName} ${execution.message} ${execution.outcome}`.toLocaleLowerCase('es').includes(query)
    const matchesStatus = executionStatus === 'all' || execution.status === executionStatus
    const matchesDate = !executionDate || localDate(execution.occurredAt) === executionDate
    return matchesQuery && matchesStatus && matchesDate
  }), [executionDate, executionQuery, executionStatus, executions])

  const selectWorkflow = (id: WorkflowId) => {
    setWorkflowId(id)
    setSelectedId(WORKFLOWS[id].nodes[0].id)
    setSelectedExecutionId(null)
  }

  const selectExecution = (execution: WorkflowExecution) => {
    setSelectedExecutionId(execution.id)
    setWorkflowId(execution.workflowId)
    if (execution.steps?.length) setSelectedId(`step-${execution.steps[execution.steps.length - 1].order}`)
    else {
      const lastNode = [...execution.path].reverse().find(id => WORKFLOWS[execution.workflowId].nodes.some(node => node.id === id))
      setSelectedId(lastNode || WORKFLOWS[execution.workflowId].nodes[0].id)
    }
  }

  return <main className={styles.workspace}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}><strong>Automatización</strong><span>/</span>Mapa operativo</p>
        <h1 className={styles.title}>Workflow</h1>
        <p className={styles.description}>Explore cómo viaja cada mensaje por el sistema y qué módulo toma cada decisión.</p>
      </div>
      <div className={styles.headerActions}>
        <AutomationSectionTabs active="workflow" />
        <span className={styles.readOnly}><LockKeyhole size={12} />Solo lectura</span>
      </div>
    </header>

    <section className={styles.intro}>
      <div className={styles.introIcon}><Info size={18} /></div>
      <div>
        <h2>{liveDefinition ? 'Está viendo una ejecución real' : 'Mapas de arquitectura y ejecuciones reales'}</h2>
        <p>{liveDefinition
          ? 'Los nodos corresponden a los pasos registrados para el mensaje seleccionado. Puede inspeccionar entradas resumidas, resultados, duración y módulo responsable.'
          : 'Los mapas explican la estructura actual. Seleccione una ejecución reciente para consultar los pasos registrados de ese mensaje.'}</p>
      </div>
    </section>

    <nav className={styles.workflowPicker} aria-label="Flujos de automatización">
      {WORKFLOW_ORDER.map(id => {
        const item = WORKFLOWS[id]
        return <button key={id} type="button" aria-pressed={workflowId === id} onClick={() => selectWorkflow(id)}>
          <span>{item.label}</span><small>{item.nodes.length} pasos</small>
        </button>
      })}
    </nav>

    {isAdmin && <section className={styles.executions} aria-label="Ejecuciones recientes">
      <header>
        <div><p>Ejecuciones recientes</p><h2>Revise por dónde pasó cada mensaje</h2></div>
        <button type="button" onClick={() => void loadExecutions()} disabled={executionsLoading}><RefreshCw size={12} className={executionsLoading ? 'animate-spin' : ''} />Actualizar</button>
      </header>
      <div className={styles.executionFilters}>
        <label><span>Buscar lead o mensaje</span><div><Search size={12} /><input value={executionQuery} onChange={event => setExecutionQuery(event.target.value)} placeholder="Ej. Carlos o visita" /></div></label>
        <label><span>Estado</span><select value={executionStatus} onChange={event => setExecutionStatus(event.target.value)}>
          <option value="all">Todos</option><option value="completed">Completado</option><option value="processing">Procesando</option>
          <option value="uncertain">Con error</option><option value="pending">Pendiente</option><option value="cancelled">Cancelado</option>
        </select></label>
        <label><span>Fecha</span><input type="date" value={executionDate} onChange={event => setExecutionDate(event.target.value)} /></label>
        <span className={styles.executionCount}>{filteredExecutions.length} de {executions.length}</span>
      </div>
      {executionsError ? <p className={styles.executionEmpty}>{executionsError}</p>
        : executionsLoading && !executions.length ? <p className={styles.executionEmpty}>Cargando ejecuciones…</p>
          : executions.length === 0 ? <p className={styles.executionEmpty}>Todavía no hay ejecuciones registradas.</p>
            : filteredExecutions.length === 0 ? <p className={styles.executionEmpty}>No hay ejecuciones que coincidan con los filtros.</p>
            : <div className={styles.executionList}>{filteredExecutions.map(execution => <button
              key={execution.id}
              type="button"
              aria-pressed={selectedExecutionId === execution.id}
              onClick={() => selectExecution(execution)}
            >
              <span className={styles.executionStatus} data-status={execution.status} />
              <span className={styles.executionBody}><strong>{execution.leadName}</strong><small>{execution.message || execution.outcome}</small><em>{execution.traceAvailable ? `${execution.steps.length} pasos registrados` : execution.traceWarning === 'AUDIT_READ_FAILED' ? 'Bitácora no disponible' : 'Sin pasos registrados · ruta inferida'}</em></span>
              <span className={styles.executionMeta}><strong>{execution.outcome}</strong><time>{formatExecutionDate(execution.occurredAt)}</time></span>
            </button>)}</div>}
      {selectedExecution && <div className={styles.executionNotice}>
        <span><Info size={13} />{selectedExecution.traceAvailable ? 'Recorrido desde pasos registrados' : selectedExecution.traceWarning === 'AUDIT_READ_FAILED' ? 'No se pudo leer la bitácora; la ruta es aproximada' : 'Ruta inferida: no demuestra qué etapas se ejecutaron'}</span>
        <strong>{selectedExecution.stopReason || selectedExecution.action || selectedExecution.status}</strong>
      </div>}
      {selectedExecution && <div className={styles.executionNotice}>
        <span>Código: {displayValue(selectedExecution.versions?.code_version)} · Contrato: {displayValue(selectedExecution.versions?.contract_version)} · Modelo: {displayValue(selectedExecution.versions?.model)}</span>
        {selectedExecution.action === 'accepted' && <strong>Entrega al teléfono sin confirmar</strong>}
      </div>}
    </section>}

    <section className={styles.flowSection}>
      <div className={styles.flowHeading}>
        <div><p>Ruta seleccionada</p><h2>{definition.label}</h2></div>
        <p>{definition.description}</p>
      </div>

      <div className={styles.explorer}>
        <div className={styles.canvas} aria-label={`Diagrama: ${definition.label}`}>
          <ReactFlow
            key={liveDefinition ? selectedExecutionId : workflowId}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: .18, maxZoom: 1 }}
            minZoom={.25}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            panOnDrag
            selectionOnDrag={false}
            onNodeClick={(_, item) => setSelectedId(item.id)}
            onPaneClick={() => setSelectedId(definition.nodes[0].id)}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d8ddd2" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={item => nodeColor((item.data as WorkflowNodeData).kind)}
              maskColor="rgba(248, 249, 245, .72)"
              className={styles.minimap}
            />
          </ReactFlow>
          <div className={styles.canvasHint}><MousePointer2 size={12} />Seleccione un nodo para ver su función</div>
        </div>

        <aside className={styles.inspector} aria-live="polite">
          <div className={styles.inspectorHeader}>
            <span className={styles.inspectorIcon} data-kind={selected.data.kind}>{renderKindIcon(selected.data.kind)}</span>
            <div><p>{KIND_LABEL[selected.data.kind]}</p><h3>{selected.data.title}</h3></div>
          </div>
          <p className={styles.inspectorSummary}>{selected.data.summary}</p>
          <dl>
            {selected.data.traceStatus && <div><dt>Ejecución</dt><dd className={styles.traceFacts}>
              <span data-status={selected.data.traceStatus}>{traceStatusLabel(selected.data.traceStatus)}</span>
              <span>{formatDuration(selected.data.durationMs)}</span>
              {selected.data.errorCode && <span>{selected.data.errorCode}</span>}
            </dd></div>}
            <div><dt>Lee</dt><dd>{selected.data.reads.length ? selected.data.reads.map(item => <span key={item}>{item}</span>) : 'Sin entradas resumidas'}</dd></div>
            <div><dt>Produce</dt><dd>{selected.data.result}</dd></div>
            <div><dt>Ubicación técnica</dt><dd><code>{selected.data.source}</code></dd></div>
            {selected.data.input && Object.keys(selected.data.input).length > 0 && <div><dt>Entrada registrada</dt><dd><TraceFields values={selected.data.input} /></dd></div>}
            {selected.data.output && Object.keys(selected.data.output).length > 0 && <div><dt>Salida registrada</dt><dd><TraceFields values={selected.data.output} /></dd></div>}
          </dl>
          <div className={styles.inspectorNote}><Bot size={15} /><p>{liveDefinition
            ? 'Esta información es de auditoría y no interviene en la respuesta del bot.'
            : 'Este mapa describe las etapas del motor; no demuestra que un mensaje haya pasado por ellas.'}</p></div>
        </aside>
      </div>
    </section>

    <section className={styles.legend} aria-label="Leyenda">
      <p>Leyenda</p>
      {(Object.keys(KIND_LABEL) as WorkflowNodeKind[]).map(kind => <span key={kind}><i data-kind={kind} />{KIND_LABEL[kind]}</span>)}
      <span className={styles.navigationHint}><Play size={11} />Use la rueda para acercar y arrastre el fondo para desplazarse</span>
    </section>
  </main>
}

function nodeColor(kind: WorkflowNodeKind) {
  return { input: '#738269', process: '#7f8f99', decision: '#ad8b51', ai: '#7c6a9b', action: '#527b79', pause: '#a9655f', success: '#4e8061' }[kind]
}

function renderKindIcon(kind: WorkflowNodeKind) {
  const Icon = KIND_ICON[kind]
  return <Icon size={17} />
}

function TraceFields({ values }: { values: Record<string, unknown> }) {
  return <ul className={styles.traceFields}>{Object.entries(values).map(([key, value]) => <li key={key}>
    <span>{fieldLabel(key)}</span><strong>{displayValue(value)}</strong>
  </li>)}</ul>
}

function traceStatusLabel(status: string) {
  return { succeeded: 'Completado', paused: 'Detenido', skipped: 'Omitido', failed: 'Error' }[status] || status
}

function formatDuration(value: unknown) {
  const milliseconds = Number(value) || 0
  if (milliseconds < 1000) return `${milliseconds} ms`
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
}

function localDate(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Guayaquil',
  }).formatToParts(date)
  const byType = new Map(parts.map(part => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function formatExecutionDate(value: string) {
  if (!value) return 'Sin fecha'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-EC', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Guayaquil' }).format(date)
}
