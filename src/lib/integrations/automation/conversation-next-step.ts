import { object, text, type Row } from './data'

/** A yes accepts continuing, but cannot choose between the alternatives in a
 * delivered question. This guard never turns an acknowledgement into an action. */
export function unresolvedChoice(current: string, pending: Row): Row | null {
  if (!['unit_choice', 'property_category', 'property_floor', 'property_bedrooms', 'property_area'].includes(text(pending.id))) return null
  const answer = current.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.!¡,¿?]/g, '').trim()
  if (!/^(?:si(?: claro| por favor| esta bien)?|claro(?: que si)?|de acuerdo|esta bien|perfecto|por supuesto)(?: gracias)?$/.test(answer)) return null
  if (!/\s(?:o|u)\s/i.test(text(pending.question))) return null
  return { question: pending.question,
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
