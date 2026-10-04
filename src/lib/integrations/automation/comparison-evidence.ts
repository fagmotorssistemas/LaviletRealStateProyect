import { object, text, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const residential = new Set(['suite', 'departamento', 'penthouse'])

/** Fresh, already authorized inventory only. This is supporting evidence, not
 * a search result, permission to change selection, or a record of availability
 * for filters outside the original query. Never reconstruct it from chat. */
export function comparisonEvidence(verified: Row, audit: Row): Row[] {
  if (object(audit.catalog_retrieval).optimized === true) return []
  if (audit.verified_catalog !== true || Object.keys(object(verified.limite_alcance)).length) return []
  const query = object(audit.catalog_query)
  const candidates = rows(verified.catalogo_verificacion)
  const category = text(query.category)
  const selected = new Set([...rows(object(audit.catalog_results).units), ...rows(object(audit.alternative_results).units)].map(u => text(u.id)))
  return candidates.filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible')
    && !selected.has(text(unit.id)) && (query.group === 'residential' || residential.has(category)
      ? residential.has(text(unit.category)) : category ? unit.category === category : true))
}

export const COMPARISON_EVIDENCE_RULES = `La búsqueda principal y la evidencia de comparación tienen funciones diferentes. query_result_ids identifica resultados de la búsqueda actual; las unidades con evidence_sources=[comparison_context] aportan datos actuales para contrastar alternativas pertinentes, no resultados que cumplan todos los filtros ni una nueva selección del cliente. Puede comparar categorías cuando ayude a atender presupuesto, objeciones o necesidades, conservando la preferencia principal. No recomiende automáticamente todo lo disponible ni reabra negativas. Los rangos se calculan para su grupo exacto. El historial explica la conversación, pero los datos comerciales se respaldan exclusivamente con las fuentes actuales compartidas por redactor y revisor. La ausencia de una categoría en query_result_ids no significa que no exista o que sus datos sean falsos.`

export const EVIDENCE_VERDICT_RULES = `Distinga el resultado de contrastar la afirmación del estado de sus fuentes: supported requiere respaldo; contradicted requiere una fuente que contradiga el hecho; unsupported corresponde a un hecho sin respaldo después de contrastarlo con las fuentes pertinentes disponibles. Si no se proporcionó la fuente necesaria o el contexto no cubre el sujeto, use needs_evidence, evidence_ids=[], e indique en evidence qué sujeto y dato faltan. No declare que un dato es falso solo porque fue omitido del contexto ni use el historial como comprobante. Antes de declarar falta de evidencia consulte también las unidades y grupos de comparison_context. Una cifra comercial sin fuente continúa siendo un dato comercial, no lead_context ni contextual_guidance. No duplique en claims un dato numérico ya extraído salvo para señalar una carencia real de evidencia; la comprobación de su valor exacto corresponde al sistema.`
