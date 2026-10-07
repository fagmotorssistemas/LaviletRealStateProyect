import type { ReactNode } from 'react'
import type { WorkflowExecutionStep } from './executionWorkflow'
import { reviewDiagnostics, reviewReferences, reviewStepRejected } from './reviewDiagnostics'
import { isObservedReview } from './reviewDecision'
import styles from './ReviewDiagnostics.module.css'

export function ReviewDiagnostics({ step }: { step: WorkflowExecutionStep }) {
  const issues = reviewDiagnostics(step)
  if (!issues.length) return null
  const observed = step.key === 'response_coverage' && isObservedReview(step.output)
  const previous = step.key === 'response_coverage' && !observed && !reviewStepRejected(step)
  return <section className={styles.diagnostics} data-historical={previous} aria-label="Campos con errores identificados">
    <h5>{observed ? 'Observaciones del modo demostración' : previous ? 'Incidencias registradas durante los intentos' : 'Qué falló y en qué campo'}</h5>
    {observed && <p>Estos controles quedaron registrados y no bloquearon el borrador del contacto de prueba. Se conservan para analizarlos; permitir el envío no significa que se hayan corregido.</p>}
    {previous && <p>Estos detalles pertenecen a intentos anteriores; no se presentan como un fallo vigente de la respuesta final.</p>}
    {issues.map((issue, i) => <div className={styles.issue} key={`${issue.code}-${i}`}>
      <strong>{issue.code}</strong><p>Campo: <code>{issue.field}</code>{issue.received !== undefined && <> · Valor recibido: <code>{JSON.stringify(issue.received)}</code></>}</p>
      <p>{issue.message}</p><small>{issue.owner}{issue.repairOwner ? ` · Encargado de corregir: ${issue.repairOwner}` : ''}</small>
      {(issue.sentenceId || issue.numericId) && <p>Referencia: {issue.sentenceId} {issue.numericId}</p>}
      {issue.fragment && <blockquote>{issue.fragment}</blockquote>}
    </div>)}
  </section>
}

export function ReviewReferenceLegend({ step }: { step: WorkflowExecutionStep }) {
  const refs = reviewReferences(step)
  if (!refs.sentences.length && !refs.evidence.length && !refs.numbers.length) return null
  return <details className={styles.references}>
    <summary>Qué significan E, S y N en esta llamada</summary>
    <p><strong>E = fuente de evidencia.</strong> E9 es la novena fuente de esta llamada; no es un error ni una puntuación.</p>
    <p><strong>S = oración del borrador.</strong> S3 identifica la tercera oración. <strong>N = referencia numérica</strong> dentro del texto. Estos identificadores son locales a la revisión; no deben compararse entre mensajes.</p>
    {refs.sentences.map(s => <p key={s.id}><code>{s.id}</code> — {s.text}</p>)}
    {refs.numbers.map(n => <p key={n.id}><code>{n.id}</code> — «{n.text}», valor {String(n.value)}, oración {n.sentenceId}.</p>)}
    {refs.evidence.map(e => <details key={e.id}><summary>{e.id} · {e.path}</summary><pre>{JSON.stringify(e.value, null, 2)}</pre></details>)}
  </details>
}

/** Highlight only the precise paths identified above, not all "supported"
 * claims or every number in the response. Rendering uses React escaping. */
export function DiagnosticJson({ value, paths = [] }: { value: unknown; paths?: string[] }) {
  const lines: ReactNode[] = []
  const write = (content: string, path: string) => lines.push(<span key={lines.length} data-invalid-field={paths.includes(path) ? path : undefined} className={paths.includes(path) ? styles.badField : undefined}>{content}{'\n'}</span>)
  const visit = (item: unknown, path: string, depth: number, key?: string, comma = false) => {
    const indent = '  '.repeat(depth), prefix = key === undefined ? '' : `${JSON.stringify(key)}: `
    if (!item || typeof item !== 'object') { write(`${indent}${prefix}${JSON.stringify(item) ?? 'null'}${comma ? ',' : ''}`, path); return }
    const array = Array.isArray(item), entries = Object.entries(item)
    if (!entries.length) { write(`${indent}${prefix}${array ? '[]' : '{}'}${comma ? ',' : ''}`, path); return }
    write(`${indent}${prefix}${array ? '[' : '{'}`, path)
    entries.forEach(([k, v], i) => visit(v, path ? `${path}.${k}` : k, depth + 1, array ? undefined : k, i < entries.length - 1))
    write(`${indent}${array ? ']' : '}'}${comma ? ',' : ''}`, '')
  }
  visit(value, '', 0)
  return <pre className={styles.json}>{lines}</pre>
}
