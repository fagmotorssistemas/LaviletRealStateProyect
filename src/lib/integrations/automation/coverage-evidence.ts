import { object,text,type Row } from './data'
import { intakeFragmentKey } from './financing-intake'

export const coverageFactKeys = ['catalog_comparison', 'bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'floor_number', 'price', 'policy', 'other'] as const
/** Only a typed fact and a verified tool receipt establish coverage. */
export function catalogCoversFragment(fragment: string, factKey: unknown, audit: Row = {}) {
  const receipt = object(audit.catalog_coverage)
  const linked = Array.isArray(receipt.fragments) && receipt.fragments.includes(fragment)
  const known = Array.isArray(receipt.known_fields) && receipt.known_fields.includes(factKey)
  return audit.verified_catalog === true && receipt.status === 'answered' && linked && known
}

export function assessMissingFacts(fragments: string[], audit: Row, facts: Row[] = [], clarification: Row = {}) {
  const assessments = [...new Set(fragments)].map(fragment => {
    const request = facts.find(row => text(row.fragment) === fragment)
    if (Array.isArray(audit.financing_orientation_fragments) && audit.financing_orientation_fragments.includes(fragment))
      return { fragment, fact_key: text(request?.fact_key) || null, outcome: 'financial_orientation',
        reason: 'La consulta pide orientación antes de iniciar: se comunican las condiciones conocidas y los parámetros pendientes; no autoriza un traspaso automático.' }
    const collection = object(audit.financing_collection)
    if (Array.isArray(collection.client_data_fragments) && collection.client_data_fragments.includes(intakeFragmentKey(fragment)))
      return { fragment, fact_key: text(request?.fact_key) || null, outcome: 'client_data_clarification',
        reason: 'Es una declaración de identidad del cliente; los datos pendientes se aclaran con él, no requieren derivación por falta de información del proyecto.' }
    const answered = catalogCoversFragment(fragment, request?.fact_key, audit)
    const question = text(clarification.text)
    // The independent reviewer identifies the current requests clarified by the
    // actual question. Descriptive evidence need not duplicate its wording.
    // Old stored reviews without this field retain their literal-reference path.
    const linkedClarification = Array.isArray(clarification.clarifies)
      ? clarification.clarifies.includes(fragment)
      : question.length > 0 && text(request?.evidence).includes(question)
    const needsClarification = clarification.validated === true && clarification.purpose === 'clarify_request'
      && question.length > 0 && ['answered', 'clarification'].includes(text(request?.status))
      && linkedClarification
    if (!answered && needsClarification) return { fragment, fact_key: text(request?.fact_key) || null,
      outcome: 'clarification_needed', reason: 'La pregunta aprobada solicita una precisión al cliente; no demuestra que falte información del proyecto.', question }
    if (!answered && request && request.base_status !== 'missing_fact' && ['answered', 'clarification', 'outside_scope'].includes(text(request.status))) return {
      fragment, fact_key: text(request.fact_key) || null, outcome: 'review_conflict',
      reason: 'La revisión marca como faltante una solicitud clasificada como atendida o aclaración. Esta contradicción no autoriza una derivación automática.' }
    return { fragment, fact_key: text(request?.fact_key) || null, outcome: answered ? 'answered_by_catalog' : 'missing_fact',
      reason: answered ? 'El catálogo verificado ya responde esta consulta.' : text(request?.evidence) || 'La revisión identificó un dato concreto sin respaldo.' }
  })
  return { assessments, unresolved: assessments.filter(item => item.outcome === 'missing_fact').map(item => item.fragment) }
}
