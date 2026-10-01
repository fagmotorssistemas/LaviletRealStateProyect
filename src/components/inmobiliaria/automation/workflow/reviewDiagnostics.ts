import type { WorkflowExecutionStep } from './executionWorkflow'

type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : []
const text = (value: unknown) => typeof value === 'string' ? value : ''
export type ReviewDiagnostic = {
  code: string; field: string; message: string; owner: string; repairOwner?: string
  fragment?: string; sentenceId?: string; numericId?: string; received?: unknown
  outputPaths?: string[]
}

export function reviewStepRejected(step: WorkflowExecutionStep) {
  return step.key === 'response_coverage' && (text(step.output.status).startsWith('rejected')
    || row(step.output.recovery).pending === true)
}

/** Display recorded errors and objectively broken array references. Does not
 * judge commercial prose, consult today's catalog, or change acceptance. */
export function reviewDiagnostics(step: WorkflowExecutionStep): ReviewDiagnostic[] {
  const result: ReviewDiagnostic[] = []
  const provider = row(step.output.provider_diagnostics)
  if (provider.incomplete_reason === 'max_output_tokens' || provider.output_budget_exhausted === true) result.push({
    code: 'max_output_tokens', field: 'provider_diagnostics.incomplete_reason', owner: 'Sistema · límite de salida configurado para la IA',
    message: `La respuesta de la IA quedó incompleta al alcanzar el límite de ${provider.configured_max_output_tokens ?? 'los'} tokens de salida. No es un rechazo del texto ni demuestra un tiempo de espera agotado.`,
    received: provider.incomplete_reason, outputPaths: ['provider_diagnostics.incomplete_reason', 'provider_diagnostics.output_budget_exhausted'],
  })
  const output = row(row(step.output.output_snapshot).data)
  rows(output.numeric_checks).forEach((check, i) => {
    for (const [indexes, list] of [['factual_value_indexes', 'factual_values'], ['project_value_indexes', 'project_values']]) {
      // An abbreviated snapshot is unknown, not an empty list.
      if (!Array.isArray(output[list])) continue
      const values = output[list] as unknown[]
      if (!Array.isArray(check[indexes])) continue
      ;(check[indexes] as unknown[]).forEach((index, j) => {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= values.length) result.push({
          code: 'missing_numeric_binding', field: `numeric_checks[${i}].${indexes}[${j}]`, owner: 'Revisor IA · ficha devuelta', repairOwner: 'Revisor IA',
          message: `La ficha apunta a ${list}[${String(index)}], pero esa entrada no existe. ${list} contiene ${values.length} entrada(s). Un índice 0 representa la primera entrada; no es el valor comercial.`,
          numericId: text(check.numeric_id), received: index,
          outputPaths: [`numeric_checks.${i}.${indexes}.${j}`, list],
        })
      })
    }
  })
  const issues: Row[] = [
    ...rows(step.output.issues), ...rows(row(step.output.semantic_review).validation_details),
    ...rows(row(step.output.final_validation).details),
    ...rows(step.output.repair_attempts).flatMap(attempt => rows(attempt.issues)),
  ]
  for (const issue of issues) {
    const binding = row(issue.binding), code = text(issue.code)
    if (!code) continue
    const bound = binding.key ? `${binding.key}[${binding.index}]` : ''
    result.push({ code, field: bound || text(issue.field) || text(issue.numeric_id) || text(issue.sentence_id) || 'Detalle de validación',
      owner: issue.owner === 'system' ? 'Sistema · comprobación de la ficha' : text(issue.owner) || 'Responsable no registrado',
      repairOwner: issue.repair_owner === 'reviewer' ? 'Revisor IA' : text(issue.repair_owner) || undefined,
      message: ['hard_fact', 'business_guardrail', 'turn_goal'].includes(code) && text(issue.reason)
        ? `${text(issue.statement) ? `${text(issue.statement)}. ` : ''}${text(issue.reason)}`
        : code === 'numeric_binding_not_in_sentence'
        ? `La referencia ${bound || 'numérica'} no existe o no pertenece a la oración indicada. Es un fallo de enlace en la ficha; por sí solo no demuestra que la cifra comercial sea falsa.`
        : code === 'numeric_binding_value_mismatch' ? 'La cifra enlazada en la ficha no coincide con la cifra de la referencia numérica registrada.'
          : 'El registro identifica este control como fallido. Consulte el campo y el fragmento asociados; no se deduce otro motivo.',
      fragment: text(issue.fragment), sentenceId: text(issue.sentence_id), numericId: text(issue.numeric_id), received: issue.received,
    })
  }
  if (step.status === 'failed' && !result.length) result.push({ code: step.errorCode || 'step_failed', field: 'errorCode', owner: 'Sistema · ejecución',
    message: 'Este paso terminó con el error registrado. Revise los pasos anteriores para identificar su causa; este código no acredita que el borrador fuera incorrecto.', received: step.errorCode })
  return [...new Map(result.map(item => [`${item.code}:${item.field}:${item.sentenceId || ''}`, item])).values()]
}

export function reviewReferences(step: WorkflowExecutionStep) {
  const data = row(row(step.input.prompt_snapshot).data)
  const resolve = (path: string): unknown => path.split('.').reduce<unknown>((value, key) => Array.isArray(value) ? value[Number(key)] : row(value)[key], data)
  return {
    sentences: rows(data.oraciones_borrador).map(s => ({ id: text(s.id), text: text(s.text) })),
    evidence: rows(data.evidencia_afirmaciones).map(e => {
      const value = row(e.value).ref ? resolve(text(row(e.value).ref)) : e.value
      return { id: text(e.id), path: text(e.path), value: value ?? 'La fuente no se conservó en esta copia del registro.' }
    }),
    numbers: rows(data.referencias_numericas).map(n => ({ id: text(n.id), sentenceId: text(n.sentence_id), text: text(n.text), value: n.value })),
  }
}
