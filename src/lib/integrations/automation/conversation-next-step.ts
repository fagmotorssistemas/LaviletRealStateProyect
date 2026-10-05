import { object, text, type Row } from './data'

/** A yes accepts continuing, but cannot choose between the alternatives in a
 * delivered question. This guard never turns an acknowledgement into an action. */
export function unresolvedChoice(current: string, pending: Row): Row | null {
  if (!['unit_choice', 'property_category', 'property_floor', 'property_bedrooms', 'property_area'].includes(text(pending.id))) return null
  const answer = current.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.!¡,¿?]/g, '').trim()
  const yes = /^(?:si(?: claro| por favor| esta bien)?|claro(?: que si)?|de acuerdo|esta bien|perfecto|por supuesto)(?: gracias)?$/.test(answer)
  const unspecifiedUnit = /^(?:si )?(?:hay|tengo) una (?:unidad|opcion) (?:que me interesa|que quisiera|que quiero)(?: revisar| ver| conocer)?(?: primero)?$/.test(answer)
  const alternatives = /\s(?:o|u)\s/i.test(text(pending.question))
  const multiple = Array.isArray(pending.candidate_ids) && pending.candidate_ids.length > 1
  const choice = ['choose_unit', 'choose_floor', 'choose_category'].includes(text(pending.act))
  const asksWhich = /\b(?:cu[aá]l|qu[eé] (?:planta|piso|tipo)|prefiere)\b/i.test(text(pending.question))
  if (!(yes && (alternatives || choice && multiple && asksWhich) || unspecifiedUnit && pending.id === 'unit_choice')) return null
  const question = unspecifiedUnit || !alternatives && pending.id === 'unit_choice' ? '¿Cuál de las unidades le interesa revisar primero?'
    : !alternatives && pending.id === 'property_floor' ? '¿En qué planta le gustaría revisar las opciones?'
      : text(pending.question)
  return { question,
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
