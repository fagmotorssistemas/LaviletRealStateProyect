import { object, text, type Row } from './data'
import { factUnits } from './structured-facts'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** Explain each defect with its own authoritative source; never synthesize a
 * replacement number from the rejected draft or another category's aggregate. */
export function concreteReviewRepairs(issues: unknown, review: Row, catalog: Row[], projectFacts: Row[]): Row[] {
  return rows(issues).map((issue, index) => {
    const source = catalog.find(row => row.id === issue.unit_id)
    const fact = rows(review.factual_values).find(row => row.unit_id === issue.unit_id
      && row.field === issue.field && row.fragment === issue.fragment)
    const project = projectFacts.find(row => row.id === issue.source_id)
    const field = text(issue.field)
    const numeric = issue.kind === 'catalog_data' && source && factUnits[field]
      && typeof source[field] === 'number' && (source.aggregation !== 'range' || typeof object(source.upper_values)[field] === 'number')
    return {
      defect_id: `D${index + 1}`, code: issue.code, owner: issue.owner || 'system',
      repair_owner: issue.repair_owner || (issue.kind === 'review_metadata' ? 'reviewer' : 'writer'),
      fragment: issue.fragment, reason: issue.reason || issue.subject || issue.code,
      ...(numeric ? {
        instruction: 'Corrija esta relación usando la fuente y los valores exactos indicados, con redacción libre. No use una cifra individual como extremo del grupo ni cambie el grupo para justificarla. Si omite un dato opcional, siga atendiendo la consulta; no lo declare corregido si solo reformuló la frase.',
        source: { id: source.id, category: source.category ?? null, bedrooms_filter: source.bedrooms_filter ?? null,
          aggregation: source.aggregation || 'individual', source_scope: source.source_scope ?? null },
        field, measurement_unit: factUnits[field],
        observed: { value: fact?.value ?? issue.received, upper_value: fact?.upper_value ?? issue.received_upper ?? null,
          operator: fact?.operator ?? issue.operator ?? 'eq', value_scope: fact?.value_scope ?? null },
        authoritative: { value: source[field], upper_value: source.aggregation === 'range' ? object(source.upper_values)[field] : null,
          ...(issue.code === 'each_member_value_mismatch' ? { member_values: issue.expected_members,
            instruction: 'Los miembros no cumplen la misma relación. Describa las diferencias o un rango real; no afirme igualdad entre ellos.' } : {}) },
      } : project ? {
        instruction: 'Corrija la cantidad del proyecto con el dato exacto de esta fuente.',
        source: { id: project.id }, observed: { value: issue.received },
        authoritative: { value: project.value, dimension: project.dimension, measurement_unit: project.unit },
      } : {
        instruction: issue.kind === 'review_metadata'
          ? 'La referencia de la revisión está pendiente de comprobar. No cambie una cifra comercial para hacerla coincidir con una fuente de otro alcance.'
          : 'Corrija la afirmación señalada con las fuentes verificadas, o retire únicamente la parte no respaldada conservando una respuesta útil.',
      }),
    }
  })
}

/** Only final checks may summarize approval. Do not send the whole old reviewer
 * sheet, its optimistic intermediate flags or obsolete numeric inventories. */
export function repairReviewSummary(review: Row, issues: unknown): Row {
  const blocking = rows(issues)
  return { status: 'rejected', answers_supported: blocking.length === 0 && review.answers_supported === true,
    content_approved: false, blocking_issues: blocking,
    review_issues: review.review_issues || [],
    instruction: 'Los controles finales y las correcciones concretas son la decisión vigente. La ficha anterior no autoriza conservar un error.' }
}

const defectKey = (issue: Row) => JSON.stringify([issue.kind, issue.code, issue.unit_id ?? null,
  issue.source_id ?? null, issue.field ?? null, issue.received ?? null, issue.received_upper ?? null,
  issue.operator ?? null, issue.subject_category ?? null])

/** Compare semantic facts, not sentences. A paraphrase cannot erase a numerical
 * defect; all remaining/new defects still pass through the normal validation. */
export function numericRepairProgress(previousIssues: unknown, currentIssues: Row[]) {
  const previous = rows(previousIssues).filter(issue => issue.kind === 'catalog_data')
  const remaining = previous.filter(prior => currentIssues.some(current => current.kind === 'catalog_data'
    && defectKey(current) === defectKey(prior)))
  return { policy: 'structured_defect_progress_v1', checked_defects: previous.length,
    repeated_defects: remaining, repeated_count: remaining.length,
    status: remaining.length ? 'same_numeric_defect' : currentIssues.length ? 'other_checks_pending' : 'validated' }
}
