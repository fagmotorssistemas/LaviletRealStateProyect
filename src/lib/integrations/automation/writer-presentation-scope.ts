import { object, text, type Row } from './data'
import { turnEvidence } from './turn-evidence'

const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : []

/** A presentation is a set chosen by the structured planner, not necessarily
 * the whole current category. Keep independent current questions available;
 * never classify the customer's words or infer a bedroom count from prose. */
export function writerPresentationEvidence<T extends { units: Row[]; groups: Row[] }>(evidence: T, verified: Row): T & { presentation_scope?: Row } {
  const plan = object(verified.siguiente_paso_comercial)
  if (!['floors', 'units', 'single_unit', 'recommended_unit', 'spacious_units'].includes(text(plan.presentation))) return evidence
  const expected = new Set(ids(object(plan.selection_scope).unit_ids))
  if (!expected.size) return evidence
  const members = evidence.units.filter(unit => expected.has(text(unit.id)))
  // An incomplete capture cannot establish the characteristics of the set.
  if (members.length !== expected.size) return evidence
  const semantics = object(verified.semantica_turno)
  const requests = Array.isArray(verified.solicitudes_interpretadas) ? verified.solicitudes_interpretadas.map(object) : []
  const hasIndependentQuery = !!text(object(semantics.catalog_request).purpose)
    || requests.some(request => ['property', 'catalog'].includes(text(request.domain)))
    || object(verified.prompt_context_selection).task === 'multiple_requests'
    || object(object(verified.property_context).query).operation === 'compare'
  const scope: Row = {
    source: 'commercial_journey.selection_scope', unit_ids: [...expected],
    categories: [...new Set(members.map(unit => text(unit.category)).filter(Boolean))],
    bedroom_counts: [...new Set(members.map(unit => unit.bedrooms).filter(value => typeof value === 'number'))].sort((a, b) => a - b),
    floors: [...new Set(members.map(unit => unit.floor_number).filter(value => typeof value === 'number'))].sort((a, b) => a - b),
    use: hasIndependentQuery ? 'presentation_beside_current_query' : 'presentation_only',
    completeness: 'known_presentation_members_only',
  }
  if (hasIndependentQuery) return { ...evidence, presentation_scope: scope }
  // Recalculate from the exact members, never reuse a wider category's range.
  // These groups remain references for the same evidence supplied to models.
  const groups = turnEvidence({ catalogo: members }).groups.filter(group => group.aggregation === 'range').map(group => ({ ...group,
    id: text(group.id).replace('group:', 'group:presentation:'), source_scope: 'presentation',
    covers: 'known_presentation_members_only', complete_for_query: false }))
  return { ...evidence, units: members, groups, query_result_ids: [], alternative_ids: [], catalog_summary: {},
    presentation_scope: scope }
}

export const WRITER_PRESENTATION_SCOPE_RULES = `Las cifras describen un conjunto concreto. evidencia_turno.presentation_scope identifica las opciones de la presentación y sus restricciones. Al resumir medidas, precios, dormitorios o plantas, nombre expresamente el tipo y las características que delimitan ese conjunto, incluso si ya se mencionaron antes: el lector debe saber a qué opciones pertenece cada cifra. Use los grupos cuyos member_ids corresponden a esas opciones; un rango general del tipo no sustituye el del subconjunto. Un mínimo y máximo iguales se comunican como un valor único. Enumere las plantas reales sin inventar niveles intermedios. No atribuya una preferencia al cliente solo porque las opciones mostradas comparten una característica. Si además hay una consulta actual o comparación más amplia, respóndala con su propia evidencia y separe los conjuntos por sus características; la selección para recomendar no limita lo que el cliente puede consultar. Un conjunto de presentación no demuestra por sí solo que no existan otras opciones en el catálogo.`
