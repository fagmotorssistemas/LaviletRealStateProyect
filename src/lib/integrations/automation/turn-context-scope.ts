import { object, text, type Row } from './data'

/** Narrow only an unambiguous single-category price turn. No keyword filtering,
 * no truncation of a group, and no inference that an empty subset is unavailable. */
export function scopeTurnCatalog(verified: Row, audit: Row): Row {
  const intent = object(audit.resolved_turn_intent || verified.contrato_turno), subject = object(intent.subject)
  const category = text(subject.category), requests = Array.isArray(intent.requests) ? intent.requests.map(object) : []
  const units = Array.isArray(verified.catalogo) ? verified.catalogo.map(object) : []
  if (audit.source !== 'unit_price' || audit.verified_price_only !== true || audit.verified_catalog === true
    || intent.objective !== 'ask_price' || !category || requests.length !== 1
    || requests.some(row => row.domain !== 'property' || row.confidence !== 'high')
    || (Array.isArray(subject.unit_numbers) && subject.unit_numbers.length)
    || Object.keys(object(verified.limite_alcance)).length) return verified
  const selected = units.filter(unit => unit.category === category)
  if (!selected.length || selected.length === units.length) return verified
  return { ...verified, catalogo: selected, catalog_context_scope: {
    kind: 'complete_category', category, available_unit_count: units.length,
    included_unit_count: selected.length, complete_for_category: true,
    note: 'Este conjunto cubre la categoría consultada; no representa ausencia de otras categorías.' } }
}
