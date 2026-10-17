import { object, text, type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

/** Acknowledgement alone cannot identify which property the client chooses. */
export function isBareAffirmative(current: string, interpreted: unknown = {}): boolean {
  const row = object(interpreted), answer = object(object(row.turn_semantics || row.semantica_turno || row).answer_to_previous)
  return answer.kind === 'affirmative' && acceptedExtractorConfidence(answer.confidence)
    && !!text(answer.evidence).trim() && current.includes(text(answer.evidence))
}

/** A yes accepts continuing, but cannot choose between the alternatives in a
 * delivered question. This guard never turns an acknowledgement into an action. */
export function unresolvedChoice(current: string, pending: Row, interpreted: unknown = {}): Row | null {
  if (!['unit_choice', 'property_category', 'property_floor', 'property_bedrooms', 'property_area'].includes(text(pending.id))) return null
  const row = object(interpreted), semantics = object(row.turn_semantics || row.semantica_turno || row)
  const answer = object(semantics.answer_to_previous), property = object(semantics.property)
  if (answer.question_id !== pending.id || !acceptedExtractorConfidence(answer.confidence)
    || !text(answer.evidence).trim() || !current.includes(text(answer.evidence))) return null
  const multiple = Array.isArray(pending.candidate_ids) && pending.candidate_ids.length > 1
  const choice = ['choose_unit', 'choose_floor', 'choose_category'].includes(text(pending.act))
  const resolved = object(semantics.unit_choice).kind === 'selected' || !!property.category
    || Array.isArray(property.unit_numbers) && property.unit_numbers.length > 0
    || Object.values(object(property.filters)).some(value => typeof value === 'number')
  if (resolved || !choice || !(answer.kind === 'uncertain' || answer.kind === 'affirmative' && (multiple || pending.act !== 'choose_unit'))) return null
  return { question: text(pending.question),
    instruction: 'La respuesta afirmativa no elige entre las alternativas de la pregunta anterior. Pregunte cuál prefiere con el tono habitual, nombrando las opciones. Solo hace falta aclarar la elección: no añada precios, plantas, medidas ni una nueva descripción del proyecto. No elija una por su cuenta, no haga todavía la comparación ni repita el catálogo.' }
}

export function needsPropertyPurpose(verified: Row, audit: Row, stage: Row): boolean {
  if (stage.requiere_captura === true || stage.presentacion_sin_tipos === true || audit.source === 'clarify_previous_choice') return false
  const semantics = object(verified.semantica_turno), property = object(semantics.property)
  const query = object(object(verified.property_context).query)
  const remembered = object(verified.hechos_confirmados)
  const objective = text(object(verified.contrato_turno || audit.resolved_turn_intent).objective) || text(semantics.primary_intent)
  const purpose = text(object(verified.lead).purchase_purpose)
  return ['ask_price', 'project_information'].includes(objective) && !query.group && !query.category
    && !property.group && !property.category && (!property.reference_kind || property.reference_kind === 'none')
    && !object(remembered.property).group && !object(remembered.household).occupants && !object(semantics.household).occupants
    && !['vivir', 'segunda_vivienda', 'negocio', 'vivienda', 'comercial', 'residential', 'commercial'].includes(purpose)
    && !(Array.isArray(object(verified.property_context).selected_ids) && (object(verified.property_context).selected_ids as unknown[]).length)
}
