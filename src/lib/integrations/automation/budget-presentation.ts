import { object, text, type Row } from './data'

const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** A presentation scope is not a new search or a change to the lead's needs.
 * Only the shared, verified plan may narrow an unsolicited recommendation. */
export function budgetRecommendationPresentation(info: Row): Row | null {
  const plan = object(info.siguiente_paso_comercial), guidance = object(plan.budget_guidance)
  const readiness = object(plan.readiness), budget = object(readiness.budget)
  const context = object(info.property_context), query = object(context.query)
  const semantics = object(info.semantica_turno), property = object(semantics.property)
  const request = object(semantics.catalog_request || info.catalog_request)
  if (plan.action !== 'select_property' || plan.question_id !== 'property_category' || plan.presentation !== 'categories'
    || readiness.financing_accepted === true || object(object(info.financiamiento).journey).accepted === true
    || budget.status !== 'maximum_total' || budget.confidence !== 'high'
    || typeof budget.amount !== 'number' || !(budget.amount > 0) || guidance.amount !== budget.amount
    || guidance.comparable !== true || guidance.membership_complete !== true || guidance.price_evidence_complete !== true
    || !['search', 'none'].includes(text(query.operation)) || query.category || query.selector || query.scope && query.scope !== 'catalog'
    || property.category || ['compare', 'details', 'select', 'rank'].includes(text(property.operation))
    || ['specific', 'comparison', 'followup'].includes(text(property.reference_kind))
    || ['compare', 'details', 'rank'].includes(text(request.purpose))
    || ['ask_price', 'ask_financing', 'request_reservation', 'ask_reservation'].includes(text(semantics.primary_intent))
    || ids(context.selected_ids).length || ids(context.comparison_ids).length || ids(property.unit_numbers).length
    || rows(info.solicitudes_interpretadas).filter(row => row.domain !== 'courtesy').length > 1) return null
  const recommended = ids(object(plan.selection_scope).unit_ids)
  const matching = new Set(ids(guidance.matching_unit_ids)), outside = ids(guidance.outside_unit_ids)
  if (!recommended.length || !outside.length || recommended.some(id => !matching.has(id))) return null
  return { kind: 'budget_matching_recommendation', unit_ids: recommended,
    canonical_query_unchanged: true,
    instruction: 'Presente únicamente estas opciones recomendadas que cumplen las necesidades y el presupuesto verificados. No enumere tipos fuera del presupuesto sin una petición actual de explorarlos o compararlos. La búsqueda original permanece disponible: si el cliente pide otra alternativa, atienda esa consulta sin cambiar sus requisitos ni su selección por iniciativa del bot.' }
}
