'use client'

import { PromptCopyButton } from './PromptCopyButton'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Node, type NodeProps, type Edge, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'
import { ARCHITECTURE_LINKS, ARCHITECTURE_NODES, architectureEventFocus, linkObserved, nodeEvidence, nodeState, type ArchitectureNode } from './architectureGraph'
import { executionCost } from './executionCost'
import { statusLabel, stepTitle } from './messageExplanation'
import styles from './ArchitectureMap.module.css'
import { ReviewDiagnostics, ReviewReferenceLegend, DiagnosticJson } from './ReviewDiagnosticsPanel'
import { reviewDiagnostics } from './reviewDiagnostics'
import { CatalogSummaryPanel } from './CatalogSummaryPanel'
import { candidateEventSteps } from './eventEvidence'

type MapNode = Node<{ spec: ArchitectureNode; state: string; count: number }, 'architecture'>
const stateLabels: Record<string, string> = { observed: 'Con registro', failed: 'Error registrado', rejected: 'Revisión con errores', paused: 'Detenido', skipped: 'Omitido explícitamente', not_selected: 'Alternativa no elegida', unknown: 'Sin registro', candidate: 'Candidato IA · sin validación', not_detected: 'No detectado en los eventos aceptados' }
function DecisionNode({ data, selected }: NodeProps<MapNode>) {
  return <div className={styles.node} data-state={data.state} data-kind={data.spec.kind} data-selected={selected}>
    <Handle type="target" position={Position.Left} />
    <small>{data.spec.owner} · {data.spec.kind === 'decision' ? 'Decisión' : data.spec.kind === 'route' ? 'Ruta' : data.spec.kind === 'agent' ? 'Agente' : data.spec.kind === 'event' ? 'Evento' : 'Operación'}</small>
    <strong>{data.spec.title}</strong><p>{data.spec.description}</p>
    <span>{data.spec.event && data.state === 'observed' ? 'Evento aceptado por los controles' : stateLabels[data.state]}{data.count > 1 ? ` · ${data.count} registros` : ''}</span>
    <Handle type="source" position={Position.Right} />
  </div>
}
const nodeTypes = { architecture: DecisionNode }

export function ArchitectureMap({ execution, onStep }: { execution?: WorkflowExecution; onStep?: (order: number) => void }) {
  const mapRef = useRef<HTMLElement>(null)
  const [selectedId, setSelectedId] = useState('message')
  const [flow, setFlow] = useState<ReactFlowInstance<MapNode, Edge> | null>(null)
  const [showSequence, setShowSequence] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === mapRef.current)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])
  async function toggleFullscreen() {
    setFullscreenError('')
    try {
      if (document.fullscreenElement === mapRef.current) await document.exitFullscreen()
      else if (mapRef.current?.requestFullscreen) await mapRef.current.requestFullscreen()
      else setFullscreenError('Este navegador no permite pantalla completa.')
    } catch {
      setFullscreenError('No se pudo abrir el mapa en pantalla completa.')
    }
  }
  const steps = useMemo(() => [...(execution?.steps || [])].sort((a, b) => a.order - b.order), [execution])
  const eventFocus = useMemo(() => architectureEventFocus(steps), [steps])
  const selected = ARCHITECTURE_NODES.find(n => n.id === selectedId) || ARCHITECTURE_NODES[0]
  const evidence = selected.event && nodeState(selected, steps) === 'candidate'
    ? candidateEventSteps(selected.event, steps) : nodeEvidence(selected, steps)
  const nodes = useMemo<MapNode[]>(() => ARCHITECTURE_NODES.map(spec => ({ id: spec.id, type: 'architecture',
    position: { x: spec.column * 350, y: spec.row * 225 }, selected: spec.id === selectedId, zIndex: 3,
    data: { spec, state: nodeState(spec, steps), count: spec.event && nodeState(spec, steps) === 'candidate' ? candidateEventSteps(spec.event, steps).length : nodeEvidence(spec, steps).length } })), [steps, selectedId])
  const edges = useMemo<Edge[]>(() => {
    const result: Edge[] = ARCHITECTURE_LINKS.map((link, i) => {
      const observed = linkObserved(link, steps)
      return { id: `architecture-${i}`, source: link.from, target: link.to, label: link.label, type: 'smoothstep', selectable: false, focusable: false, interactionWidth: 0,
        markerEnd: { type: MarkerType.ArrowClosed, color: observed ? '#287047' : '#b7bfc2' },
        style: { stroke: observed ? '#287047' : '#b7bfc2', strokeWidth: observed ? 3 : 1, strokeDasharray: observed ? undefined : '5 5' },
        labelStyle: { fontSize: 11 }, labelBgStyle: { fill: '#fff' }, zIndex: observed ? 1 : 0 }
    })
    if (showSequence) {
      // This is temporal order only, not inferred causation or a selected branch.
      const ordered = steps.map(step => ({ step, node: ARCHITECTURE_NODES.find(n => !n.branch && !n.event && !['repair_metadata', 'repair_draft', 'catalog_summary'].includes(n.id) && nodeEvidence(n, [step]).length) }))
        .filter((v): v is { step: WorkflowExecutionStep; node: ArchitectureNode } => !!v.node)
      for (let i = 1; i < ordered.length; i++) {
        const previous = ordered[i - 1], current = ordered[i]
        if (previous.node.id !== current.node.id) result.push({ id: `order-${current.step.order}`, source: previous.node.id, target: current.node.id,
          label: `Orden ${previous.step.order} → ${current.step.order}`, type: 'smoothstep', selectable: false, focusable: false, interactionWidth: 0, markerEnd: { type: MarkerType.ArrowClosed, color: '#4266a0' }, style: { stroke: '#4266a0', strokeWidth: 2 }, zIndex: 2 })
      }
    }
    return result
  }, [steps, showSequence])
  const unmatched = steps.filter(s => !ARCHITECTURE_NODES.some(n => nodeEvidence(n, [s]).length))
  return <section ref={mapRef} className={styles.map} aria-label="Mapa de arquitectura y decisiones">
    <header><div><h2>Mapa de decisiones y rutas</h2><p>Todos los caminos permanecen visibles. Las conexiones punteadas describen posibilidades; no prueban que se ejecutaron.</p></div>
      <label><input type="checkbox" checked={showSequence} onChange={e => setShowSequence(e.target.checked)} disabled={!steps.length} /> Mostrar orden registrado</label></header>
    <p className={styles.notice}>{execution ? `Mensaje seleccionado: ${execution.message || execution.id}` : 'Vista general: seleccione un mensaje para superponer sus registros.'}</p>
    <div className={styles.legend}><span>Verde: registro observado, no aprobación automática</span><span>Rojo: error de ejecución o revisión</span><span>Gris: sin registro o alternativa no elegida</span><span>Ámbar: evento candidato de la IA sin validación</span><span>Azul: orden temporal, no causalidad</span></div>
    <nav className={styles.navigation} aria-label="Acercar a una parte del mapa">
      <button type="button" onClick={() => void flow?.fitView({ padding: 0.08, duration: 300 })}>Ver todo</button>
      <button type="button" onClick={() => {
        setSelectedId('catalog_summary'); void flow?.fitView({ nodes: [{ id: 'catalog_summary' }], padding: 0.5, duration: 300, maxZoom: 0.9 })
      }}>Resumen del catálogo</button>
      {nodes.some(n => ['failed', 'rejected'].includes(n.data.state)) && <button type="button" onClick={() => {
        const first = nodes.find(n => ['failed', 'rejected'].includes(n.data.state))!
        setSelectedId(first.id); void flow?.fitView({ nodes: [{ id: first.id }], padding: 0.5, duration: 300, maxZoom: 0.9 })
      }}>Ir al primer error</button>}
      {[
        ['Inicio', ['message', 'permission', 'context']], ['Alcance', ['scope_ai', 'scope', 'scope_property', 'scope_uncertain']],
        ['Eventos simultáneos', eventFocus.ids],
        ['Objetivos', ['intent', ...ARCHITECTURE_NODES.filter(n => n.id.startsWith('intent_')).map(n => n.id)]],
        ['Catálogo y perfil', ['catalog', 'profile', 'introduction', 'catalog_clarify', 'embedding_search', 'embedding_applied', 'embedding_bypassed', 'catalog_exact']],
        ['Presupuesto', ['budget', ...ARCHITECTURE_NODES.filter(n => n.id.startsWith('budget_')).map(n => n.id)]],
        ['Redacción y revisión', ['coverage', 'writer', 'reviewer', 'draft_validation', 'repair_metadata', 'repair_draft']],
        ['Envío y recuperación', ['validation', 'failure', 'delivery', 'memory', 'exit']],
        ...(['pauses', 'visits', 'financing', 'nutrition'] as const).map((key, i) => [ ['Permisos', 'Visitas', 'Financiamiento', 'Seguimientos'][i], ARCHITECTURE_NODES.filter(n => n.id.startsWith(`${key}:`)).map(n => n.id)]),
      ].map(([label, ids]) => <button type="button" key={String(label)} onClick={() => void flow?.fitView({ nodes: (ids as string[]).map(id => ({ id })), padding: 0.15, duration: 300, maxZoom: 0.9 })}>{label}</button>)}
    </nav>
    <p className={styles.notice}>{eventFocus.isGeneral
      ? 'Eventos simultáneos: el atajo muestra los diez eventos posibles porque este mensaje no tiene eventos aceptados ni candidatos registrados.'
      : `Eventos del mensaje: ${eventFocus.accepted} aceptados y ${eventFocus.candidates} candidatos sin validación. El atajo los acerca; todos los eventos posibles permanecen en el mapa.`}</p>
    <div className={styles.workspace}>
      <div className={styles.canvas}>
        <div className={styles.fullscreenControl}>
          <button type="button" onClick={() => void toggleFullscreen()} aria-pressed={isFullscreen}>
            {isFullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            {isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          </button>
          {fullscreenError && <span className={styles.fullscreenError} role="alert">{fullscreenError}</span>}
        </div>
        <div className={styles.flowSurface}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setFlow} defaultViewport={{ x: 20, y: -380, zoom: 0.65 }} minZoom={0.02} maxZoom={1.5}
            nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => setSelectedId(node.id)}>
            <Background gap={24} /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={n => n.data.state === 'observed' ? '#43845d' : n.data.state === 'candidate' ? '#ba8736' : ['failed', 'rejected'].includes(String(n.data.state)) ? '#ba4141' : '#bec5c2'} />
          </ReactFlow>
        </div>
      </div>
      <aside className={styles.inspector} aria-live="polite">
        <small>{selected.owner} · {stateLabels[nodeState(selected, steps)]}</small><h3>{selected.title}</h3><p>{selected.description}</p>
        <dl><dt>Ubicación</dt><dd>{selected.source}</dd><dt>Identificador</dt><dd><code>{selected.branch ? `${selected.branch.field} = ${selected.branch.value}` : selected.key || selected.id}</code></dd></dl>
        {selected.event && <p>{nodeState(selected, steps) === 'candidate'
          ? 'Este evento aparece en una salida de la IA, pero no hay un registro de interpretación válida que lo acepte. Se muestra como candidato; no acredita permiso ni ejecución de una operación.'
          : 'Varios eventos pueden estar presentes en el mismo turno. No se recorren en orden y no equivalen a consentimiento, envío, reserva ni cita confirmada.'}</p>}
        {selected.branch && <p>Este nodo muestra un objetivo o resultado interpretado. No acredita por sí solo que se ejecutó una acción comercial.</p>}
        {selected.id === 'catalog_summary' && <CatalogSummaryPanel steps={steps} onStep={onStep} />}
        {selected.id !== 'catalog_summary' && !evidence.length && <p>{nodeState(selected, steps) === 'not_selected' ? 'Se registró otro valor para esta decisión.' : 'No hay evidencia suficiente para afirmar que este paso se ejecutó o se omitió.'}</p>}
        {selected.id !== 'catalog_summary' && evidence.map(step => <details key={step.order} className={styles.record} open={evidence.length === 1}>
          <summary>Paso {step.order} · {stepTitle(step)} · {statusLabel(step.status)}</summary>
          <p>{(step.durationMs / 1000).toLocaleString('es-EC')} s{step.errorCode ? ` · ${step.errorCode}` : ''}</p>
          {step.key === 'response_coverage' && <p>Incluye el tiempo de las llamadas internas; no sumarlo de nuevo al de los agentes.</p>}
          {step.key === 'model_request' && <CallCost step={step} />}
          {step.key === 'model_request' && <PromptCopyButton step={step} />}
          <ReviewDiagnostics step={step} /><ReviewReferenceLegend step={step} />
          <h4>Entrada registrada</h4><pre>{JSON.stringify(step.input, null, 2)}</pre>
          <h4>{selected.event && nodeState(selected, steps) === 'candidate' ? 'Salida candidata de la IA · no aceptada' : 'Salida registrada'}</h4><DiagnosticJson value={step.output} paths={reviewDiagnostics(step).flatMap(issue => (issue.outputPaths || []).map(path => path.startsWith('provider_diagnostics.') ? path : `output_snapshot.data.${path}`))} />
          {onStep && <button type="button" onClick={() => onStep(step.order)}>Ver explicación y borrador de este paso</button>}
        </details>)}
      </aside>
    </div>
    <details className={styles.accessible}><summary>Lista accesible de nodos y sus decisiones</summary>
      {ARCHITECTURE_NODES.map(n => <button type="button" key={n.id} onClick={() => setSelectedId(n.id)} aria-pressed={selectedId === n.id}>{n.title} · {stateLabels[nodeState(n, steps)]}</button>)}
    </details>
    {unmatched.length > 0 && <details className={styles.accessible}><summary>Otros pasos registrados ({unmatched.length})</summary><p>Se conservan aunque no tengan un nodo dedicado en este mapa; no se les asigna una ruta inferida.</p>
      {unmatched.map(s => <button type="button" key={s.order} onClick={() => onStep?.(s.order)}>Paso {s.order}: {stepTitle(s)}</button>)}
    </details>}
    <p className={styles.notice}>El mapa describe la versión actual. En registros antiguos pueden faltar decisiones. Los eventos forman un grupo simultáneo después de validar la interpretación; solo los aceptados se resaltan en verde. Los objetivos pueden coexistir con otras solicitudes del mismo mensaje. Las reparaciones se detallan por intento, sin sustituir el primer borrador.</p>
  </section>
}

function CallCost({ step }: { step: WorkflowExecutionStep }) {
  const cost = executionCost([step])
  return <p>Modelo: {String(step.input.model || step.output.model || 'No registrado')} · {cost.totalTokens.toLocaleString('es-EC')} tokens registrados · {cost.pricedCalls ? `USD ${cost.estimatedUsd.toFixed(6)} estimados` : 'Costo no disponible'}</p>
}
