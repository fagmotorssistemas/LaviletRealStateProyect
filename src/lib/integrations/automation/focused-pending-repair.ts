import { object, text, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
type PendingScope = { focused_sentence_ids: string[] }
const normalize = (value: unknown) => text(value).normalize('NFC').trim().replace(/\s+/g, ' ')
function sentenceId(fragment: unknown, sentences: Row[]): string {
  const value = normalize(fragment)
  const byId = sentences.find(sentence => sentence.id === value)
  if (byId) return text(byId.id)
  const matches = sentences.filter(sentence => normalize(sentence.text) === value)
  return matches.length === 1 ? text(matches[0].id) : ''
}

/** Stable IDs address the complete prior pending list, not its filtered subset. */
export function pendingReferencesForRepair(value: unknown, scope: PendingScope, sentences: Row[]): Row[] {
  const entire = sentences.every(sentence => scope.focused_sentence_ids.includes(text(sentence.id)))
  return rows(value).flatMap<Row>((pending, index) => {
    const id = sentenceId(pending.fragment, sentences)
    return id ? scope.focused_sentence_ids.includes(id)
      ? [{ ...pending, pending_id: `P${index + 1}`, pending_index: index, sentence_id: id }] : []
      : entire ? [{ ...pending, pending_id: `P${index + 1}`, pending_index: index, sentence_id: null }] : []
  })
}

/** Schema for the pending_resolutions property of a repair response only. */
export function pendingResolutionSchema(value: unknown, scope: PendingScope, sentences: Row[]): Row {
  const references = pendingReferencesForRepair(value, scope, sentences)
  const indexes = { type: 'array', maxItems: 80, items: { type: 'integer', minimum: 0, maximum: 79 } }
  const empty = { ...indexes, maxItems: 0 }
  const fields = { pending_id: { type: 'string', enum: references.length ? references.map(row => row.pending_id) : ['none'] },
    resolution: { type: 'string', enum: ['resolved', 'not_asserted'] },
    claim_indexes: indexes, factual_value_indexes: indexes, project_value_indexes: indexes, reason: { type: 'string' } }
  const variant = (overrides: Row) => ({ type: 'object', additionalProperties: false,
    properties: { ...fields, ...overrides }, required: Object.keys(fields) })
  return { type: 'array', maxItems: references.length, items: { anyOf: [
    variant({ resolution: { type: 'string', enum: ['resolved'] }, claim_indexes: { ...indexes, minItems: 1 } }),
    variant({ resolution: { type: 'string', enum: ['resolved'] }, claim_indexes: empty, factual_value_indexes: { ...indexes, minItems: 1 } }),
    variant({ resolution: { type: 'string', enum: ['resolved'] }, claim_indexes: empty, factual_value_indexes: empty,
      project_value_indexes: { ...indexes, minItems: 1 } }),
    variant({ resolution: { type: 'string', enum: ['not_asserted'] }, claim_indexes: empty, factual_value_indexes: empty, project_value_indexes: empty }),
  ] } }
}

/** A checked fact cannot implicitly resolve a different pending assertion in
 * the same sentence. The model must name the pending check and its resolution. */
export function mergePendingRepairs(previous: Row, repaired: Row, scope: PendingScope, sentences: Row[]) {
  const references = pendingReferencesForRepair(previous.pending_checks, scope, sentences)
  const resolutions = rows(repaired.pending_resolutions), accepted: Row[] = [], issues: Row[] = [], removed = new Set<number>()
  const fail = (resolution: Row, reason: string) => issues.push({ code: 'invalid_pending_repair_resolution', kind: 'review_metadata',
    owner: 'system', repair_owner: 'reviewer', pending_id: resolution.pending_id, reason,
    ...(resolution.fragment ? { fragment: resolution.fragment } : {}) })
  if (repaired.pending_resolutions !== undefined && !Array.isArray(repaired.pending_resolutions))
    fail({}, 'La lista de resoluciones pendientes no tiene el formato esperado.')
  for (const resolution of resolutions) {
    const reference = references.find(row => row.pending_id === resolution.pending_id)
    if (!reference) { fail(resolution, 'La comprobación pendiente no pertenece al alcance de esta reparación.'); continue }
    const groups = [['claim_indexes', 'claims'], ['factual_value_indexes', 'factual_values'], ['project_value_indexes', 'project_values']]
    if (resolutions.filter(row => row.pending_id === resolution.pending_id).length !== 1 || !text(resolution.reason).trim()
      || groups.some(([field]) => !Array.isArray(resolution[field]) || (resolution[field] as unknown[]).length > 80
        || new Set(resolution[field] as unknown[]).size !== (resolution[field] as unknown[]).length
        || (resolution[field] as unknown[]).some(index => typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 79))) {
      fail(resolution, 'Cada comprobación pendiente necesita una resolución única, un motivo y listas de índices válidos.'); continue
    }
    const links = groups.flatMap(([field, key]) => (resolution[field] as number[]).map(index => ({ key, index })))
    if (resolution.resolution === 'not_asserted' && links.length === 0) {
      removed.add(reference.pending_index as number); accepted.push(resolution); continue
    }
    if (resolution.resolution !== 'resolved' || links.length === 0 || !reference.sentence_id
      || links.some(({ key, index }) => {
        const fact = rows(repaired[key])[index]
        return !fact || sentenceId(fact.fragment, sentences) !== reference.sentence_id
      })) {
      fail(resolution, 'Resolver una comprobación exige enlazar hechos nuevos de la misma oración; una referencia vacía o ajena no la resuelve.'); continue
    }
    removed.add(reference.pending_index as number); accepted.push(resolution)
  }
  const incoming = rows(repaired.pending_checks).filter(pending => {
    if (scope.focused_sentence_ids.includes(sentenceId(pending.fragment, sentences))) return true
    fail(pending, 'La nueva comprobación pendiente no pertenece a las oraciones autorizadas para esta reparación.')
    return false
  })
  return { pending_checks: [...rows(previous.pending_checks).filter((_pending, index) => !removed.has(index)), ...incoming],
    resolutions: accepted, issues }
}
