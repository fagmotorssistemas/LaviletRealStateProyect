import { object, text, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const hasValue = (value: unknown): boolean => value != null && value !== ''
  && (Array.isArray(value) ? value.some(hasValue)
    : typeof value === 'object' ? Object.values(object(value)).some(hasValue) : true)

/** A generic first presentation has no catalogue question. Require independent
 * stage and interpretation signals before omitting it; uncertainty keeps the
 * full evidence. An omitted catalogue never represents an empty search. */
function projectIntroduction(verified: Row, audit: Row, intent: Row, subject: Row, requests: Row[]) {
  const semantics = object(verified.semantica_turno), property = object(semantics.property)
  const reference = object(verified.referencia_unidad), context = object(verified.property_context)
  return intent.objective === 'project_information'
    && object(audit.profile_introduction).generic_introduction === true
    && ['commercial', 'project_overview', 'project_information_choice', ''].includes(text(audit.source))
    && semantics.confidence === 'high' && semantics.primary_intent === 'project_information'
    && property.operation === 'none' && property.reference_kind === 'none'
    && requests.length === 1 && requests[0].domain === 'property' && requests[0].confidence === 'high'
    && !hasValue(intent.required_facts) && !hasValue(subject.category)
    && !hasValue(subject.unit_numbers) && !hasValue(subject.filters)
    && !hasValue(property.category) && !hasValue(property.group) && !hasValue(property.unit_numbers)
    && !hasValue(property.filters) && !hasValue(property.selector) && !hasValue(property.excluded_categories)
    && !hasValue(semantics.housing_quantities)
    && !hasValue(context.selected_ids) && !hasValue(context.offered_ids)
    && !hasValue(reference.matches) && reference.needsClarification !== true
    && !hasValue(audit.catalog_results) && !hasValue(audit.alternative_results)
    && !hasValue(audit.price_evidence) && !hasValue(audit.unit_model)
    && !hasValue(audit.selected_unit_ids) && !hasValue(audit.offered_unit_ids)
    && !['mixed', 'out_of_scope'].includes(text(object(intent.scope).kind))
}

/** No keyword filtering, group truncation, or inference that an omitted subset
 * is unavailable. Scope is selected from the interpreted request and stage. */
export function scopeTurnCatalog(verified: Row, audit: Row): Row {
  const intent = object(audit.resolved_turn_intent || verified.contrato_turno), subject = object(intent.subject)
  const category = text(subject.category), requests = rows(intent.requests), units = rows(verified.catalogo)
  if (audit.verified_catalog === true || Object.keys(object(verified.limite_alcance)).length) return verified
  if (projectIntroduction(verified, audit, intent, subject, requests)) return {
    ...verified, catalogo: [], catalog_context_scope: {
      kind: 'project_overview', catalog_status: 'not_applicable', included_unit_count: 0,
      note: 'Catálogo omitido en esta presentación general. No es una búsqueda vacía ni acredita disponibilidad, precios, límites o ausencia de inmuebles. Las políticas, los hechos del proyecto y el estado operativo se conservan.',
    },
  }
  if (audit.source !== 'unit_price' || audit.verified_price_only !== true
    || intent.objective !== 'ask_price' || !category || requests.length !== 1
    || requests.some(row => row.domain !== 'property' || row.confidence !== 'high')
    || (Array.isArray(subject.unit_numbers) && subject.unit_numbers.length)) return verified
  const selected = units.filter(unit => unit.category === category)
  if (!selected.length || selected.length === units.length) return verified
  return { ...verified, catalogo: selected, catalog_context_scope: {
    kind: 'complete_category', category, available_unit_count: units.length,
    included_unit_count: selected.length, complete_for_category: true,
    note: 'Este conjunto cubre la categoría consultada; no representa ausencia de otras categorías.' } }
}
