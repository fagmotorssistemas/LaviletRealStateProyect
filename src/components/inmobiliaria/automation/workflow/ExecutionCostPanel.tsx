'use client'

import { useState } from 'react'
import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'
import { executionCost, promptCharacters, sumPromptCharacters } from './executionCost'
import { catalogSearchDiagnostics } from './catalogSearchExplanation'
import { callCatalogMode, comparisonCandidates, executionCatalogMode, isCostStep, normalCallEstimate, normalExecutionEstimate } from './embeddingCostComparison'
import { stepTitle } from './messageExplanation'
import { executionTiming, durationLabel } from './executionTiming'
import styles from './ExecutionCostPanel.module.css'

const number = (n: number) => n.toLocaleString('es-EC')
const money = (n: number) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(n)
const date = (e: WorkflowExecution) => new Date(e.receivedAt || e.occurredAt).toLocaleString('es-EC')
const price = (cost: ReturnType<typeof executionCost>) => cost.pricedCalls ? `${money(cost.estimatedUsd)}${cost.complete ? '' : ' (parcial)'}` : cost.calls ? 'No disponible' : money(0)
const role = (s: WorkflowExecutionStep) => s.key === 'catalog_embedding_search' ? 'Consulta de embeddings'
  : ({ scope: 'Clasificador', extractor: 'Extractor', writer: 'Redactor', reviewer: 'Revisor' }[String(s.input.ai_role)]
    || (s.input.task === 'writing' ? 'Redactor' : s.input.task === 'review' ? 'Revisor' : 'Otros agentes'))
const characters = (value: number | null | undefined) => value == null ? 'Sin dato' : number(value)
const modelLabel = (step: WorkflowExecutionStep) => {
  if (step.key !== 'catalog_embedding_search') return String(step.output.model || step.input.model || 'Modelo sin registrar')
  const diagnostics = catalogSearchDiagnostics(step.output)
  return `Previsto: ${diagnostics.plannedModel}. Consultado: ${diagnostics.consultedModel}.`
}

export function AgentCallCost({ step }: { step: WorkflowExecutionStep }) {
  const cost = executionCost([step]), estimate = normalCallEstimate(step), size = promptCharacters(step)
  return <div className={styles.call}>
    <strong>{callCatalogMode(step)} · Costo calculado con uso registrado: {price(cost)}</strong>
    {size && <p><strong>Caracteres enviados:</strong> instrucciones: {characters(size.instructions)} · contexto: {characters(size.context)} · formato: {characters(size.schema)} · prefijo: {characters(size.user_prefix)} · total: {characters(size.total)}.</p>}
    {cost.measuredCalls > 0 && <p>Entrada: {number(cost.inputTokens)} tokens, incluidos {number(cost.cachedInputTokens)} en caché. Salida: {number(cost.outputTokens)}. Total: {number(cost.totalTokens)}.</p>}
    {cost.pricedCalls > 0 && <p>Entrada sin caché: {money(cost.inputUsd)} · Entrada en caché: {money(cost.cachedUsd)} · Salida: {money(cost.outputUsd)}.</p>}
    {!cost.complete && <p>Registro parcial: falta uso o tarifa; los importes disponibles no representan el costo completo.</p>}
    {size && <p>Las instrucciones son las reglas compuestas de esta llamada. Los caracteres miden texto; el costo se calcula con tokens del proveedor. Un dato ausente no se reconstruye desde la captura protegida.</p>}
    {estimate && <p><strong>Escenario de contexto anterior, estimación de esta llamada:</strong> ≈ {number(estimate.totalTokens)} tokens ({number(estimate.inputTokens)} de entrada + {number(estimate.outputTokens)} de salida); ≈ {money(estimate.cost.estimatedUsd)} manteniendo la proporción de caché. Con entrada totalmente en caché: {money(estimate.allCachedUsd)}; sin caché: {money(estimate.noCacheUsd)}. La salida se mantiene igual solo para comparar.</p>}
  </div>
}

export function ExecutionCostPanel({ execution, executions, onStep }: {
  execution: WorkflowExecution; executions: WorkflowExecution[]; onStep: (order: number) => void;
}) {
  const [compareId, setCompareId] = useState('')
  const cost = executionCost(execution.steps), mode = executionCatalogMode(execution)
  const timing = executionTiming(execution)
  const estimate = normalExecutionEstimate(execution)
  const candidates = comparisonCandidates(execution, executions)
  const compared = candidates.find(c => c.execution.id === compareId)?.execution
  const calls = execution.steps.filter(isCostStep)
  const queryCost = executionCost(execution.steps.filter(s => s.key === 'catalog_embedding_search'))
  const otherCost = compared ? executionCost(compared.steps) : null
  const roles = [...new Set([...calls, ...(compared?.steps.filter(isCostStep) || [])].map(role))]
  return <section className={styles.panel} aria-label="Consumo y comparación de embeddings">
    <div className={styles.heading}><h4>Consumo y comparación</h4><span>{mode}</span></div>
    <div className={styles.counters}>
      <div><span>Costo de esta ejecución</span><strong>{price(cost)}</strong><small>Calculado con uso registrado y tarifas</small></div>
      <div><span>Tokens registrados</span><strong>{number(cost.totalTokens)}</strong><small>{number(cost.inputTokens)} entrada · {number(cost.outputTokens)} salida</small></div>
      <div><span>Entrada en caché</span><strong>{number(cost.cachedInputTokens)}</strong><small>Ya incluida en los tokens de entrada</small></div>
      <div><span>Consulta de embeddings</span><strong>{price(queryCost)}</strong><small>{queryCost.calls && !queryCost.measuredCalls ? 'Consumo sin registrar' : `${number(cost.embeddingTokens)} tokens registrados`}</small></div>
      <div><span>{timing.sent ? 'Tiempo hasta envío' : 'Tiempo registrado'}</span><strong>{durationLabel(timing.sent ? timing.responseMs : timing.elapsedMs)}</strong><small>{timing.sent ? 'Desde recepción hasta aceptación del envío por Kommo; entrega al teléfono sin confirmar.' : 'Hasta el cierre registrado; no hay un envío exitoso en estos pasos.'}</small></div>
    </div>
    {!cost.complete && <p className={styles.notice}>Total parcial: {cost.pricedCalls} de {cost.calls} llamadas con uso y tarifa conocidos. No se interpreta un dato ausente como gasto cero.</p>}
    {cost.unmeasuredTransportAttempts > 0 && <p className={styles.notice}>{cost.unmeasuredTransportAttempts} intento(s) de conexión anterior(es) sin consumo confirmado. El proveedor podría haberlos procesado; no se inventa su costo.</p>}
    <details open>
      <summary>Desglose por llamada: uso registrado y escenario estimado</summary>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Tabla de costos por agente">
        <table><thead><tr><th>Agente / paso</th><th>Contexto usado</th><th>Instrucciones (car.)</th><th>Contexto (car.)</th><th>Formato (car.)</th><th>Prefijo (car.)</th><th>Total (car.)</th><th>Entrada (tokens)</th><th>En caché¹</th><th>Salida (tokens)</th><th>Duración</th><th>Costo calculado²</th><th>Escenario estimado³</th></tr></thead>
          <tbody>{calls.map(step => {
            const actual = executionCost([step]), normal = normalCallEstimate(step), size = promptCharacters(step)
            return <tr key={step.order}><th><button type="button" onClick={() => onStep(step.order)}>{stepTitle(step)} · {step.order}</button><small>{modelLabel(step)}</small></th>
              <td>{callCatalogMode(step)}</td>{(['instructions', 'context', 'schema', 'user_prefix', 'total'] as const).map(key => <td key={key}>{size ? characters(size[key]) : 'No aplica'}</td>)}<td>{actual.measuredCalls ? number(actual.inputTokens) : actual.calls ? 'Sin dato' : '0'}</td>
              <td>{actual.complete ? number(actual.cachedInputTokens) : 'Sin dato'}</td><td>{actual.measuredCalls ? number(actual.outputTokens) : actual.calls ? 'Sin dato' : '0'}</td><td>{durationLabel(step.durationMs)}</td><td>{price(actual)}</td>
              <td>{normal ? <>≈ {number(normal.totalTokens)} tokens<small>≈ {money(normal.cost.estimatedUsd)}</small></>
                : step.key === 'catalog_embedding_search' ? actual.calls > 0 ? 'Uso incluido en el costo calculado' : catalogSearchDiagnostics(step.output).requested === false ? 'Sin consulta: 0' : 'Sin estimación'
                  : callCatalogMode(step) === 'Recorrido normal' ? 'Este es el uso real' : 'Sin estimación'}</td></tr>
          })}</tbody>
        </table>
      </div>
      {estimate ? <p className={styles.scenario}><strong>Recorrido normal estimado: ≈ {number(estimate.totalTokens)} tokens · ≈ {money(estimate.usd)}.</strong>
        {cost.complete && <> Diferencia frente al uso registrado: {number(estimate.totalTokens - cost.totalTokens)} tokens y {money(estimate.usd - cost.estimatedUsd)} (normal menos actual; un valor negativo indica que el normal sería menor).</>}</p>
        : <p>{['Con embeddings', 'Consulta exacta reducida'].includes(mode) ? 'No hay una estimación completa del recorrido normal para este registro. Puede compararlo con otra ejecución real abajo.'
          : 'Este mensaje muestra el gasto del recorrido ejecutado. Para conocer el gasto con embeddings, seleccione una prueba real que los haya utilizado. No se inventa una selección semántica ni se genera otra respuesta automáticamente.'}</p>}
      <p className={styles.notes}>¹ La caché es parte de la entrada, no se suma otra vez. ² Tokens informados por la API; dólares calculados, no factura. Incluye borradores descartados, revisiones y consulta de embeddings, incluso si la búsqueda terminó usando el catálogo normal.</p>
      <p className={styles.notes}>Caracteres (car.): medición del texto antes de proteger o abreviar la captura. Incluye instrucciones compuestas, contexto JSON, formato exigido y prefijo; excluye archivos binarios. No equivale a tokens ni incluye el tamaño de los adjuntos. «Sin dato» indica que ese registro no conservó la medición.</p>
      <p className={styles.notes}>Tiempo de procesamiento: {durationLabel(timing.processingMs)}. Espera previa desde la recepción: {durationLabel(timing.waitingMs)}. Los tiempos de pasos que se solapan no se suman.</p>
      <p className={styles.notes}>³ Estimación aproximada por tamaño del contexto ampliado, calibrada con los tokens reales de cada llamada. Conserva modelo, salida, número de llamadas y proporción de caché; esas condiciones podrían cambiar en una ejecución real. No predice otra respuesta ni si sería aprobada. La comparación se calcula localmente, sin llamadas adicionales a la IA.</p>
    </details>
    <details open>
      <summary>Comparar con otra ejecución real</summary>
      <label className={styles.select}>Ejecución de comparación
        <select value={compareId} onChange={event => setCompareId(event.target.value)}>
          <option value="">Seleccionar prueba anterior…</option>
          {candidates.map(({ execution: item, sameMessage }) => <option key={item.id} value={item.id}>{sameMessage ? 'Mismo mensaje · ' : ''}{date(item)} · {executionCatalogMode(item)} · {item.leadName} · {item.message.slice(0, 90)}</option>)}
        </select>
      </label>
      <p className={styles.notes}>Se muestran las ejecuciones cargadas; puede cargar mensajes anteriores al final de la página. Repetir el texto no garantiza el mismo historial, estado del lead, catálogo, modelo o caché. La diferencia observada no se atribuye automáticamente a embeddings.</p>
      {compared && otherCost && <>
        <p><strong>Comparación:</strong> actual ({mode}) frente a {date(compared)} ({executionCatalogMode(compared)}). Resultado anterior: {compared.outcome}.</p>
        <div className={styles.scroll} tabIndex={0} role="region" aria-label="Comparación de costos reales">
          <table><thead><tr><th>Agente</th><th>Actual: llamadas / tokens / USD</th><th>Comparada: llamadas / tokens / USD</th></tr></thead><tbody>
            {roles.map(name => { const a = executionCost(calls.filter(s => role(s) === name)), b = executionCost(compared.steps.filter(s => isCostStep(s) && role(s) === name))
              return <tr key={name}><th>{name}</th><td>{a.calls} / {number(a.totalTokens)} / {price(a)}</td><td>{b.calls} / {number(b.totalTokens)} / {price(b)}</td></tr> })}
            <tr><th>Total</th><td>{cost.calls} / {number(cost.totalTokens)} / {price(cost)}</td><td>{otherCost.calls} / {number(otherCost.totalTokens)} / {price(otherCost)}</td></tr>
          </tbody></table>
        </div>
        <div className={styles.scroll} tabIndex={0} role="region" aria-label="Comparación de caracteres registrados por agente">
          <table><thead><tr><th>Agente</th><th>Ejecución / llamadas</th><th>Instrucciones (car.)</th><th>Contexto (car.)</th><th>Formato (car.)</th><th>Prefijo (car.)</th><th>Total (car.)</th></tr></thead><tbody>
            {roles.filter(name => name !== 'Consulta de embeddings').flatMap(name => ([['Actual', calls], ['Comparada', compared.steps.filter(isCostStep)]] as const).map(([label, source]) => {
              const agentCalls = source.filter(step => role(step) === name), size = sumPromptCharacters(agentCalls)
              return <tr key={`${name}:${label}`}><th>{name}</th><td>{label} · {agentCalls.length} llamada{agentCalls.length === 1 ? '' : 's'}</td>{(['instructions', 'context', 'schema', 'user_prefix', 'total'] as const).map(key => <td key={key}>{size ? characters(size[key]) : 'Sin dato'}</td>)}</tr>
            }))}
          </tbody></table>
        </div>
        <p className={styles.notes}>Se suman todas las llamadas de cada agente, incluidas correcciones. Si alguna llamada no registró una medida, ese total se muestra como «Sin dato»; no se compara una suma parcial con una completa.</p>
        {cost.complete && otherCost.complete ? <p><strong>Diferencia registrada (comparada menos actual):</strong> {number(otherCost.totalTokens - cost.totalTokens)} tokens · {money(otherCost.estimatedUsd - cost.estimatedUsd)}.</p>
          : <p>Alguno de los totales es parcial; no se calcula un ahorro con registros incompletos.</p>}
      </>}
    </details>
    <small>Tarifas registradas: {cost.priceVersion}. No incluye generación inicial del índice, audio, voz ni servicios externos. <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">Tarifas de OpenAI</a>.</small>
  </section>
}
