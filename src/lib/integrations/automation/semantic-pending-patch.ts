import { object, type Row } from './data'
import { focusedRepairScope, focusedReviewSchema, RELATIONAL_FACT_RULES } from './focused-review'
import { mergePendingRepairs, pendingReferencesForRepair, pendingResolutionSchema } from './focused-pending-repair'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
type Scope = ReturnType<typeof focusedRepairScope>

/** Use this only after every other check passed. No prose interpretation or
 * keyword exception: the existing issues identify the unresolved sentences. */
export function semanticPendingScope(issues: Row[], previous: Row, sentences: Row[]): Scope | null {
  if (!issues.length || issues.some(issue => issue.code !== 'review_sentence_pending'
    || !sentences.some(s => s.id === issue.sentence_id))) return null
  const scope = focusedRepairScope(issues, sentences, [])
  const pending = pendingReferencesForRepair(previous.pending_checks, scope, sentences)
  return pending.length && pending.every(p => p.sentence_id) ? scope : null
}

export function semanticPendingSchema(schema: Row, previous: Row, scope: Scope, sentences: Row[]): Row {
  const focused = focusedReviewSchema(schema, scope.sentences, [], [], [])
  const properties = object(focused.properties)
  for (const key of ['factual_values', 'project_values', 'numeric_checks', 'obligation_checks', 'non_factual_sentence_ids'])
    properties[key] = { ...object(properties[key]), minItems: 0, maxItems: 0 }
  const narrow = (item: Row): Row => Array.isArray(item.anyOf)
    ? { ...item, anyOf: item.anyOf.map(v => narrow(object(v))) }
    : { ...item, properties: { ...object(item.properties), fragment: { type: 'string', enum: scope.focused_sentence_ids } } }
  properties.claims = { ...object(properties.claims), items: narrow(object(object(properties.claims).items)) }
  const resolutions = pendingResolutionSchema(previous.pending_checks, scope, sentences)
  resolutions.items = { anyOf: rows(object(resolutions.items).anyOf).filter(v => {
    const fields = object(v.properties)
    return !Number(object(fields.factual_value_indexes).minItems) && !Number(object(fields.project_value_indexes).minItems)
  }).map(v => {
    const fields = { ...object(v.properties) }
    for (const key of ['factual_value_indexes', 'project_value_indexes']) fields[key] = { ...object(fields[key]), maxItems: 0 }
    return { ...v, properties: fields }
  }) }
  properties.pending_resolutions = resolutions
  return { ...focused, properties, required: Object.keys(properties) }
}

export function mergeSemanticPendingPatch(previous: Row, patch: Row, scope: Scope, sentences: Row[], original: string, current: string): Row {
  if (original !== current) throw new Error('SEMANTIC_REPAIR_DRAFT_CHANGED')
  const pending = mergePendingRepairs(previous, patch, scope, sentences)
  const errors: Row[] = [...pending.issues]
  const fail = (field: string) => errors.push({ code: 'semantic_repair_outside_scope', kind: 'review_metadata',
    owner: 'system', repair_owner: 'reviewer', field, reason: 'La reparación semántica intentó modificar comprobaciones ya conservadas.' })
  for (const field of ['factual_values', 'project_values', 'numeric_checks', 'obligation_checks', 'non_factual_sentence_ids', 'claim_resolutions', 'dismissed_numeric_checks'])
    if (Array.isArray(patch[field]) && (patch[field] as unknown[]).length) fail(field)
  const accepted = rows(patch.claims).filter(claim => {
    if (scope.sentences.some(s => claim.fragment === s.id || claim.fragment === s.text)) return true
    fail('claims'); return false
  })
  return { ...previous, claims: [...rows(previous.claims), ...accepted], pending_checks: pending.pending_checks,
    pending_resolutions: pending.resolutions, pending_repair_issues: errors }
}

export const SEMANTIC_PENDING_RULES = `Repare únicamente los pendientes P_ID indicados del MISMO borrador. Las comprobaciones numéricas, obligaciones y afirmaciones ya contrastadas se conservan; no las vuelva a generar. Devuelva solo claims que resuelvan esos pendientes y pending_resolutions con los enlaces correspondientes. Un P_ID sin resolución explícita se conserva. not_asserted solo corresponde si el borrador no afirma ese hecho, nunca para omitir una relación real o un hecho sin respaldo. No deje pendiente una relación simplemente por no contener cifras: contrástela con las fuentes. Si no está respaldada, devuelva el claim unsupported; si está contradicha, contradicted. Si realmente no puede completar la comprobación, mantenga el pendiente con una razón concreta. No reescriba el borrador. ` + RELATIONAL_FACT_RULES
