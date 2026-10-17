import { actionAuthorized, actionDecision, normalizedActionAuthority } from './action-authority'
import { bedroomComparison,type BedroomComparison } from './bedroom-comparison'
import { bedroomOptions } from './bedroom-options'
import { object,text,type Row } from './data'
import { DISCOUNT_REQUEST_EXTRACTION_RULES,DISCOUNT_REQUEST_SCHEMA,normalizedDiscountRequest } from './discount-request'
import { acceptedExtractorConfidence,combinedExtractorConfidence } from './extractor-confidence'
import { INTERACTION_GOAL_RULES,INTERACTION_GOAL_SCHEMA,normalizedInteractionGoal } from './interaction-mode'
import { LEAD_NURTURE_EXTRACTION_RULES,LEAD_NURTURE_SCHEMA,normalizedNurtureRequest } from './lead-nurture-state'
import { AMOUNT_REFERENCE_SCHEMA } from './monetary-reference'
import { PROPERTY_CATEGORIES } from './property-category-contract'
import { explicitReservationAction,simpleReservationAcceptance,verifiedReservationInvitation } from './reservation-invitation'

import { SELECTION_PREFERENCES_RULES,SELECTION_PREFERENCES_SCHEMA,VIEWS_PREFERENCE_RULES,normalizedSelectionPreferences } from './selection-preferences'
import { budgetAmountForCurrentTurn } from './turn-interpretation-input'

export const questionIds = [
  'reservation_invitation',
  'financing_invitation',
  'financing_partner',
  'financing_data',
  'financing_down_payment',
  'property_purpose',
  'visit_invitation',
  'visit_destination',
  'visit_date_time',
  'budget_amount',
  'budget_kind',
  'property_category',
  'property_comparison',
  'property_floor',
  'property_bedrooms',
  'property_area',
  'property_priority',
  'property_requirements',
  'unit_choice',
  'purchase_timing',
  'lead_profile',
  'lead_profile_name',
  'lead_profile_residence',
  'lead_residence_confirmation',
  'brochure_offer',
  'showroom_information',
] as const

export type PendingQuestionId = typeof questionIds[number]

const primaryIntents = new Set([
  'request_visit', 'request_reservation', 'ask_reservation', 'answer_previous', 'select_property', 'ask_price', 'discuss_budget',
  'ask_financing', 'project_information', 'other',
])
const answerKinds = new Set(['affirmative', 'negative', 'uncertain', 'value', 'none'])
const budgetStatuses = new Set([
  'amount_pending', 'no_defined_budget',
  'not_discussed', 'unknown', 'amount', 'maximum_total', 'initial_capital',
  'sufficient_for_selected_unit', 'insufficient_for_selected_unit', 'declines_to_disclose',
])
const propertyCategories = new Set<string>(PROPERTY_CATEGORIES)
const referenceKinds = new Set(['none', 'explicit', 'relative', 'comparison', 'followup'])
const unitSelectors = new Set(['largest', 'smallest', 'cheapest', 'most_expensive', 'first', 'last'])
const operations = new Set(['search', 'rank', 'compare', 'select', 'details', 'none'])
const queryScopes = new Set(['catalog', 'offered', 'comparison', 'selected'])
export const questionActs = new Set(['choose_unit', 'confirm_unit', 'show_unit_details', 'explore_quoted_options', 'compare_properties', 'choose_category', 'choose_floor', 'explore_alternatives', 'confirm_bedrooms', 'confirm_priority', 'budget', 'visit', 'profile', 'reservation', 'financing', 'material', 'other'])
const profileQuestionIds = new Set(['lead_profile', 'lead_profile_name', 'lead_profile_residence', 'lead_residence_confirmation'])
const reservationKinds = new Set(['request', 'information', 'declined', 'none'])

export type PropertyFilters = BedroomComparison & { floor_number: number | null; bedrooms: number | null; bedrooms_any?: number[]; bedrooms_required: boolean | null; min_area_m2: number | null; max_area_m2: number | null }
export const emptyPropertyFilters = (): PropertyFilters => ({ floor_number: null, bedrooms: null, bedrooms_required: null, min_area_m2: null, max_area_m2: null })
const enumSchema = (values: Iterable<string>) => ({ type: 'string', enum: [...values] })
const nullableEnumSchema = (values: Iterable<string>) => ({ type: ['string', 'null'], enum: [...values, null] })
const strictObject = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const confidenceSchema = enumSchema(['high', 'medium', 'low'])
const housingQuantityDimensions = new Set(['people', 'bedrooms', 'unknown'])
const housingQuantityRoles = new Set(['requirement', 'evaluation', 'context', 'unknown'])
const housingQuantityBases = new Set(['total', 'excluding_speaker', 'unspecified'])

/** The complete strict schema for the turn_semantics property of an extraction. */
export const TURN_SEMANTICS_SCHEMA = strictObject({
  primary_intent: enumSchema(primaryIntents), primary_evidence: { type: 'string' }, confidence: confidenceSchema,
  interaction_goal: INTERACTION_GOAL_SCHEMA,
  nurture_request: LEAD_NURTURE_SCHEMA,
  discount_request: DISCOUNT_REQUEST_SCHEMA,
  selection_preferences: SELECTION_PREFERENCES_SCHEMA,
  unit_choice: strictObject({ kind: { ...enumSchema(['selected', 'conditional', 'rejected', 'none']), description: 'Decisión independiente de primary_intent. «El 605 me gusta más, ¿qué precio tenía?» elige 605 y también consulta precio. Solo preguntar su precio o cómo verlo no elige. rejected identifica las unidades expresamente descartadas. Una condición pendiente o negación no es selected. No use historial como aceptación actual.' },
    unit_numbers: { type: 'array', items: { type: 'string' } }, evidence: { type: 'string' }, confidence: confidenceSchema }),
  category_choice: strictObject({kind:{...enumSchema(['selected','conditional','none']),description:'Preferencia actual por un tipo de espacio, independiente de la consulta principal. «Me quedo con los penthouses; ¿qué precio tienen?» elige categoría y consulta precio. Consultar precios de una categoría sin preferirla no la elige. No selecciona una unidad ni autoriza trámites.'},
    category:nullableEnumSchema(propertyCategories),evidence:{type:'string'},confidence:confidenceSchema}),
  preference_change: strictObject({ kind: enumSchema(['cheaper', 'fewer_bedrooms', 'none']),
    bedrooms: { type: ['integer', 'null'], minimum: 1, maximum: 30 },
    bedroom_decision: enumSchema(['keep', 'reduce', 'specified', 'unspecified']),
    evidence: { type: 'string' }, confidence: confidenceSchema }),
  housing_quantities: { type: 'array', description: 'Solo cantidades declaradas o evaluadas en mensaje_actual; [] si no hay. Nunca copie cantidades del catálogo, de una pregunta previa ni del historial. No cree elementos vacíos.', items: strictObject({ dimension: enumSchema(housingQuantityDimensions),
    values: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 1000 } },
    role: { ...enumSchema(housingQuantityRoles), description: 'requirement busca/restringe; evaluation consulta si las opciones sirven; context describe la familia; unknown es ambiguo. Evaluar capacidad no impone otra búsqueda.' }, count_basis: enumSchema(housingQuantityBases), evidence: { type: 'string' }, confidence: confidenceSchema }) },
  answer_to_previous: strictObject({ question_id: enumSchema([...questionIds, 'none']), kind: enumSchema(answerKinds), evidence: { type: 'string' }, confidence: confidenceSchema }),
  reservation: strictObject({ kind: enumSchema(reservationKinds), evidence: { type: 'string' },
    unit_numbers: { type: 'array', items: { type: 'string' } }, reference_kind: enumSchema(['explicit', 'contextual', 'none']), confidence: confidenceSchema }),
  property: strictObject({
    group: nullableEnumSchema(['residential', 'commercial']), category: nullableEnumSchema(propertyCategories),
    excluded_categories: { type: 'array', items: enumSchema(propertyCategories) }, operation: enumSchema(operations),
    reference_kind: enumSchema(referenceKinds), unit_numbers: { type: 'array', items: { type: 'string' } },
    selector: nullableEnumSchema(unitSelectors), query_scope: nullableEnumSchema(queryScopes),
    filters: strictObject({ floor_number: { type: ['integer', 'null'] }, bedrooms: { type: ['integer', 'null'] }, bedrooms_any: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 30 } }, bedrooms_operator: { type: ['string', 'null'], enum: ['eq', 'gte', 'lte', 'between', null] }, bedrooms_upper: { type: ['integer', 'null'], minimum: 1, maximum: 30 }, bedrooms_required: { type: ['boolean', 'null'] }, min_area_m2: { type: ['number', 'null'] }, max_area_m2: { type: ['number', 'null'] } }),
    filter_evidence: strictObject(Object.fromEntries(['floor_number', 'bedrooms', 'bedrooms_any', 'bedrooms_operator', 'bedrooms_upper', 'bedrooms_required', 'min_area_m2', 'max_area_m2'].map(key => [key, { type: 'string' }]))),
    evidence: { type: 'string' }, confidence: confidenceSchema,
  }),
  budget: strictObject({ status: enumSchema(budgetStatuses), subject: enumSchema(new Set(['total_budget', 'down_payment', 'unspecified'])), amount: { type: ['number', 'null'] }, amount_reference_id: AMOUNT_REFERENCE_SCHEMA,
    evidence: { type: 'string' }, confidence: confidenceSchema }),
})

export function normalizedPropertyFilters(raw: unknown): PropertyFilters {
  const row = object(raw)
  const bounded = (key: string, max: number, integer = false, minimum = 0) => typeof row[key] === 'number' && Number.isFinite(row[key])
    && Number(row[key]) >= minimum && Number(row[key]) <= max && (!integer || Number.isInteger(row[key])) ? Number(row[key]) : null
  const choices = bedroomOptions(row.bedrooms_any)
  return { ...(choices.length > 1 ? { bedrooms_any: choices } : {}), floor_number: bounded('floor_number', 100, true), bedrooms: choices.length > 1 ? null : bounded('bedrooms', 30, true), bedrooms_required: typeof row.bedrooms_required === 'boolean' ? row.bedrooms_required : null,
    min_area_m2: bounded('min_area_m2', 100000, false, 1), max_area_m2: bounded('max_area_m2', 100000, false, 1), ...bedroomComparison(row) }
}

/** Durable queries contain catalogue constraints, never a model-authored action. */
export function normalizedPropertyQuery(raw: unknown): Row {
  const row = object(raw)
  if (!Object.keys(row).length) return {}
  const category = propertyCategories.has(text(row.category)) ? text(row.category) : null
  return {
    group: category === 'local' ? 'commercial' : category ? 'residential'
      : ['residential', 'commercial'].includes(text(row.group)) ? text(row.group) : null,
    category, filters: normalizedPropertyFilters(row.filters),
    ...(Array.isArray(row.requirements) && row.requirements.length ? { requirements: row.requirements } : {}),
    operation: operations.has(text(row.operation)) ? text(row.operation) : 'search',
    selector: unitSelectors.has(text(row.selector)) ? text(row.selector) : null,
    scope: queryScopes.has(text(row.scope || row.query_scope)) ? text(row.scope || row.query_scope) : 'catalog',
  }
}

/** Retired text parser: filters come only from the current extractor contract. */
export function propertyFiltersFromText(_current: string, _pendingId = ''): PropertyFilters { void _pendingId;  return emptyPropertyFilters() }

export function propertyPreferenceChange(current: string, previousQuery: unknown, semantics?: unknown): Row {
  const previous = normalizedPropertyFilters(object(previousQuery).filters)
  const property = object(object(semantics).property)
  const filters = acceptedExtractorConfidence(property.confidence) ? normalizedPropertyFilters(property.filters) : emptyPropertyFilters()
  const before = previous.bedrooms ?? (previous.bedrooms_any?.length ? Math.min(...previous.bedrooms_any) : null)
  const fewer = before !== null && filters.bedrooms !== null && filters.bedrooms < before
  const change = object(object(semantics).preference_change)
  const valid = acceptedExtractorConfidence(change.confidence) && !!literalEvidence(change.evidence, current)
    && ['cheaper', 'fewer_bedrooms'].includes(text(change.kind))
  const specified = typeof change.bedrooms === 'number' && Number.isInteger(change.bedrooms)
    && change.bedrooms > 0 && change.bedrooms <= 30 ? change.bedrooms : filters.bedrooms
  const reduce = valid && (change.kind === 'fewer_bedrooms' || change.bedroom_decision === 'reduce')
  const bedrooms = valid && change.bedroom_decision === 'keep' ? before : specified
  return { kind: valid ? change.kind : fewer ? 'fewer_bedrooms' : null, bedrooms, previous_bedrooms: before,
    fewer_bedrooms: reduce || fewer,
    requires_bedroom_confirmation: valid && change.kind === 'cheaper' && change.bedroom_decision === 'unspecified' && bedrooms === null,
    evidence: valid ? change.evidence : fewer ? property.evidence : '' }
}

export function normalizedPendingQuestion(raw: unknown, catalog?: Row[]): Row {
  const row = object(raw), id = text(row.id)
  if (!questionIds.includes(id as PendingQuestionId)) return {}
  if (profileQuestionIds.has(id)) {
    const candidate = object(row.residence_candidate)
    const city = text(candidate.city).trim().slice(0, 160) || null, country = text(candidate.country).trim().slice(0, 160) || null
    const evidence = text(candidate.evidence).trim().slice(0, 240)
    return { id, act: 'profile', question: text(row.question).trim().slice(0, 500), target_ids: [], candidate_ids: [],
      ...(id === 'lead_residence_confirmation' && (city || country) && evidence ? { residence_candidate: { city, country, evidence } } : {}) }
  }
  const validIds = catalog ? new Set(catalog.map(unit => text(unit.id))) : null
  const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(text).filter(id => id && (!validIds || validIds.has(id))))] : []
  const proposedQuery = ['explore_alternatives', 'confirm_bedrooms', 'choose_category', 'choose_floor'].includes(text(row.act)) ? normalizedPropertyQuery(row.proposed_query) : {}
  const comparisonCategories = id === 'property_comparison' && Array.isArray(row.comparison_categories)
    ? [...new Set(row.comparison_categories.map(text).filter(category => propertyCategories.has(category)))] : []
  const comparisonBedrooms = typeof row.comparison_bedrooms === 'number' && Number.isInteger(row.comparison_bedrooms) && row.comparison_bedrooms > 0 && row.comparison_bedrooms <= 30 ? row.comparison_bedrooms : null
  const comparisonCandidates = comparisonCategories.length > 1 && catalog ? catalog.filter(unit => comparisonCategories.includes(text(unit.category))
    && (comparisonBedrooms === null || unit.bedrooms === comparisonBedrooms) && unit.is_published !== false && (!unit.status || unit.status === 'disponible')).map(unit => text(unit.id)) : null
  const proposedEntry = object(row.amount_reference)
  // The writer owns the meaning of its delivered question. Validate this
  // persisted monetary receipt as data; never reparse the writer's wording.
  const entryReference = id === 'financing_down_payment' && proposedEntry.kind === 'proposed_down_payment'
    && proposedEntry.original_role === 'total_budget' && typeof proposedEntry.amount === 'number'
    && Number.isFinite(proposedEntry.amount) && proposedEntry.amount > 0 && !!text(proposedEntry.evidence).trim()
    && !!text(proposedEntry.question_source).trim() && !!text(proposedEntry.delivered_question).trim()
    && ['delivered_total_budget_entry_proposal', 'writer_structured_total_budget_entry_proposal'].includes(text(proposedEntry.resolution))
    ? proposedEntry : null
  const targets = ids(row.target_ids)
  const reservationInvitation = id === 'reservation_invitation' && row.act === 'reservation'
    && verifiedReservationInvitation(row.reservation_invitation, targets) ? object(row.reservation_invitation) : null
  return { id, act: questionActs.has(text(row.act)) ? text(row.act) : id === 'unit_choice' ? 'choose_unit' : id === 'property_floor' ? 'choose_floor'
    : id === 'property_category' ? 'choose_category' : id === 'reservation_invitation' ? 'reservation' : id === 'brochure_offer' ? 'material'
    : id.startsWith('financing') ? 'financing' : id.startsWith('budget') ? 'budget' : id.startsWith('visit') ? 'visit' : 'other',
  ...(id === 'financing_data' && Array.isArray(row.requested_fields) ? { requested_fields: row.requested_fields.filter(value => typeof value === 'string') } : {}),
  question: text(row.question).trim().slice(0, 500), target_ids: targets, candidate_ids: comparisonCandidates ?? ids(row.candidate_ids),
  ...(comparisonCategories.length > 1 ? { comparison_categories: comparisonCategories, comparison_bedrooms: comparisonBedrooms } : {}),
  ...(entryReference ? { amount_reference: entryReference } : {}),
  ...(reservationInvitation ? { reservation_invitation: reservationInvitation } : {}),
  ...(id === 'budget_amount' && row.budget_basis === 'total_budget' ? { budget_basis: 'total_budget' } : {}),
  ...(Object.keys(proposedQuery).length ? { proposed_query: { ...proposedQuery, operation: 'search', selector: null } } : {}) }
}

export const RELATIVE_PROPERTY_CHOICE_RULE = 'Una elección relativa actual, como «prefiero el que tiene más baños», puede identificar en unit_numbers la única unidad que cumple esa referencia entre las opciones ofrecidas, aunque no escriba su código. Use operation=select, reference_kind=relative y evidencia literal de la elección. Si hay empate o falta el atributo, no elija ni invente un código. Preguntar cuál tiene más baños es información, no selección. Conserve la elección aunque el mismo grupo también pregunte el precio o añada comentarios; elegir categoría conserva las necesidades ya aceptadas.'

export const TURN_SEMANTIC_EXTRACTION_RULES = INTERACTION_GOAL_RULES + '\n' + LEAD_NURTURE_EXTRACTION_RULES + `
${RELATIVE_PROPERTY_CHOICE_RULE}
${DISCOUNT_REQUEST_EXTRACTION_RULES}
${SELECTION_PREFERENCES_RULES}
${VIEWS_PREFERENCE_RULES}
Devuelva SIEMPRE turn_semantics conforme al esquema JSON estricto adjunto; sus campos, tipos y valores permitidos se definen allí.
preference_change interpreta si ahora pide opciones más económicas o menos dormitorios, con cualquier redacción. bedroom_decision distingue mantener la cantidad actual, reducirla, indicar otra cantidad o dejarla sin definir. No adivine una cantidad para «menos» ni suponga que buscar algo más económico autoriza reducir dormitorios. Una unidad descartada se registra en unit_choice.kind=rejected con sus códigos; una consulta de características no descarta ni elige. Estos significados se interpretan aquí, no mediante palabras clave posteriores.
Interprete el mensaje actual junto con historial_reciente y pregunta_pendiente. El historial aclara referencias como "sí", "esa", "ese precio" o "no estoy seguro", pero la evidencia siempre debe copiar palabras del mensaje ACTUAL.
reservation distingue la intención de iniciar la separación/reserva (request), consultar condiciones o requisitos sin iniciar (information), rechazar o posponer ese proceso (declined) y ausencia de esa intención (none). «Quiero separar el 605», «ayúdeme a iniciar la reserva de esa unidad» y sus errores evidentes de escritura son request; «¿cuánto se paga para reservar?» o «¿cómo funciona la separación?» son information. «Por ahora no, entonces quiero separar el departamento 605» responde negativamente a la propuesta anterior y pide una reserva NUEVA: conserve answer_to_previous y use primary_intent=request_reservation, reservation.kind=request. La unidad mencionada identifica el objeto de la reserva, no convierte el turno en una nueva presentación ni en un recorrido. Copie evidencia literal de la petición completa, incluidas negaciones, condiciones y correcciones relevantes; no cite solo el verbo de una frase negada. Una reserva hipotética o condicionada no satisfecha no inicia el trámite. primary_intent=ask_reservation para information. El evento asked_reservation sirve para puntuar interés, nunca demuestra por sí solo que desea iniciar ahora. unit_numbers conserva los códigos realmente referidos y el catálogo comprobará su existencia; en referencias como «esa» puede usar una unidad inequívoca del contexto, nunca elegir entre varias. Solicitar el proceso requiere atención del asesor; no afirma disponibilidad, pago, reserva confirmada, cita, consentimiento financiero ni asesor asignado. No convierta la aceptación de detalles, una cifra de precio, un «sí» sin pregunta de reserva ni el historial en una solicitud nueva.
En property.filters declare únicamente restricciones expresadas en el mensaje ACTUAL y copie en filter_evidence la frase literal que sustenta cada campo; deje vacío el resto. Las características de unidades ya ofrecidas pertenecen al contexto, no son filtros nuevos. Para comparar, pedir detalles o clasificar esas opciones, use operation, reference_kind, query_scope y unit_numbers; no repita sus dormitorios, planta o áreas como restricciones actuales. Una nueva restricción sí puede refinar el conjunto referido y necesita su propia evidencia, aunque esté expresada de forma natural y sin cifras.
Antes de fijar dormitorios, interprete el significado de cada cantidad relevante en housing_quantities. dimension=people cuenta ocupantes/familiares; bedrooms cuenta dormitorios; unknown conserva una cantidad cuyo objeto no se puede resolver. Nunca convierta personas en dormitorios ni deduzca cuartos por ocupante. values contiene las cantidades expresadas (también en palabras) y queda [] si no hay una cantidad conocida. Para personas use count_basis=total si la cifra incluye al hablante, excluding_speaker si explícitamente lo excluye, unspecified si no se sabe; el sistema suma uno únicamente en excluding_speaker. «Somos seis» es people [6] total; «es para mi familia, unas cinco sin contar conmigo» es people [5] excluding_speaker, NO bedrooms=5. «Somos varios» conserva people [] unspecified. Si hay una corrección, conserve la cantidad corregida con la evidencia que la distingue; no sume familiares o cifras que puedan solaparse.
role=requirement expresa una restricción solicitada; evaluation pregunta si las opciones o su distribución sirven al cliente; context describe su situación sin imponer un filtro. Un número de dormitorios en property.filters debe corresponder a housing_quantities con dimension=bedrooms y role=requirement. «Somos seis y busco tres cuartos» separa people [6] context de bedrooms [3] requirement. «¿Alcanzarán tres dormitorios para una familia de seis?» separa bedrooms [3] evaluation y people [6] context: no introduce una nueva búsqueda, conserva las opciones ofrecidas con operation=details y reference_kind=followup cuando existan. Puede orientar sobre esas distribuciones sin volver a preguntar cuántos dormitorios quiere. Una respuesta numérica a la pregunta pendiente de dormitorios sí puede ser requirement aunque no repita el sustantivo. La evidencia debe conservar el contexto que distingue las cantidades, no solo una cifra aislada. No rellene cantidades a partir del historial. Use [] cuando este turno no declare ni evalúe cantidades de vivienda.
NECESIDADES Y EVALUACIÓN: edad, niños, mascotas, movilidad declarada y muebles pueden orientar la respuesta sobre las opciones conocidas. Conserve las preguntas actuales en requests con su evidencia e incluya el contexto personal necesario para entenderlas; una necesidad deducida no es una preferencia confirmada ni autoriza añadir filtros, dormitorios, planta, superficie, requisitos obligatorios o una selección. La edad sola no declara movilidad reducida; tener hijos no fija ocupantes ni dormitorios; tener mascotas no confirma la política del proyecto ni solicita automáticamente una terraza. Cantidades y dimensiones de muebles, mascotas o edades no son cantidades de personas ni dormitorios: no las introduzca en housing_quantities para completar campos. Si el cliente expresa por separado una restricción o un cambio real, extraiga únicamente esa declaración y su evidencia.
Una consulta de cabida de camas o muebles, circulación, comodidad familiar, accesibilidad o reglas de mascotas es informativa. Con una unidad, comparación o alternativas activas use details o compare, el referente y query_scope vigentes; no inicie search o select solo por esa duda. Una situación personal sin petición nueva tampoco reinicia la búsqueda. Conserve todas las consultas de un mensaje, incluidas las pendientes aún vigentes, y cualquier respuesta explícita a la pregunta pendiente. Preguntar si una opción sirve no acepta cambiar requisitos, una visita, atención humana, reserva ni financiamiento. Si todavía no respondió la decisión comercial pendiente, answer_to_previous conserva none; el sistema retomará esa decisión después de responder la duda.
Resuelva primero sobre QUÉ pide información. Una solicitud general tras solo saludos es primary_intent=project_information y property.operation=none, aunque tenga errores de escritura. Con una unidad o alternativas activas, «quiero información», «sí, envíeme detalles» o «¿y los precios?» continúan ese referente: use details, followup y el alcance correspondiente; no reinicie la presentación ni busque todo el catálogo. Una petición explícita de información general del proyecto cambia el tema. Si hay varias solicitudes, conserve todas; si el referente es ambiguo, no invente una unidad. Aceptar explorar alternativas no elimina la necesidad original, pero la búsqueda activa debe seguir las alternativas propuestas, no repetir el filtro sin resultados.
Distinga necesidad original de consulta activa: «como le mencioné necesito cinco, pero quiero saber de los de tres dormitorios» conserva cinco como necesidad contextual y solicita detalles de las alternativas de tres. catalog_request debe limitar esta consulta a tres, no exigir simultáneamente cinco. Consultar esas alternativas autoriza conocerlas, no declara que resuelvan la necesidad ni elige tipo o unidad. Una consulta de precio o recorrido conserva la decisión comercial pendiente; responder que busca vivir captura el uso sin reiniciar dormitorios ni tipos. «Bueno, gracias» sin aceptación inequívoca no cambia la propuesta.
answer_to_previous solo puede usar el question_id exacto recibido en pregunta_pendiente. Si no responde esa pregunta, use question_id=none y kind=none.
Las preguntas lead_profile, lead_profile_name y lead_profile_residence recogen nombre y/o residencia; lead_residence_confirmation confirma si residence_candidate es la residencia actual. Una respuesta «sí» a esa confirmación es affirmative SOLO de lead_residence_confirmation, nunca acepta una visita, crédito o unidad. «No, vivo en otra ciudad» puede contestar negative y aportar la residencia explícita al perfil. El lugar candidato y su evidencia pertenecen al perfil, no al catálogo: nunca los convierta en unit_numbers, filtros o una propiedad seleccionada. Cuando no hay una pregunta de confirmación con candidato registrado, un «sí» aislado no declara una ciudad. Una respuesta al perfil puede además traer otra consulta; preserve ambas sin inventar autorización operativa.
Una aceptación de una invitación a visita, incluso "sí está bien", es affirmative de visit_invitation. Una fecha u hora dada como respuesta es value de visit_date_time.
En budget, no_defined_budget significa que declara no tener presupuesto definido («todavía no tengo uno», «no he establecido cuánto»). amount_pending significa que confirma tener presupuesto sin decir cuánto («sí tengo» ante esa pregunta). unknown conserva una duda o importe ambiguo; not_discussed significa que este turno no declara presupuesto. No confunda estos estados. sufficient_for_selected_unit significa que afirma que el precio de la unidad elegida sí se ajusta a su presupuesto; insufficient_for_selected_unit afirma lo contrario. No convierta una simple aceptación, una cifra del precio citada por el bot ni una duda en capacidad de pago.
Con pregunta_pendiente.id=reservation_invitation un sí inequívoco solicita iniciar esa reserva: reservation.kind=request, evidencia literal del sí y las unidades de target_ids; un no es declined. Con financing_invitation, «bueno continuemos» acepta continuar la orientación financiera, nunca una visita o un asesor. Conserve answer_to_previous con su id exacto. No asigne un significado distinto cuando la pregunta tiene alternativas ambiguas.
amount se completa solo con una cifra expresada por el cliente en el mensaje actual. No copie cifras del historial.
property.category solo indica una preferencia AFIRMADA AHORA: suite|departamento|penthouse|local, no la última categoría mencionada ni una inferencia del historial. En "me interesan más los departamentos porque los penthouse deben ser muy caros", category=departamento y excluded_categories=[penthouse]. Mencionar una opción para descartarla no es elegirla. Una preocupación por precios no declara un presupuesto.
property.group distingue residential (vivienda en general) de commercial (locales). «Me interesa vivienda» y «algo para vivir» son group=residential, category=null, excluded_categories=[]: no implican elegir departamento ni excluir suites o penthouses. Solo complete category si el mensaje realmente elige o consulta esa categoría concreta. Cada excluded_categories requiere una declaración actual referida a ese tipo o un rechazo inequívoco al único tipo propuesto en la pregunta pendiente; no copie exclusiones históricas ni infiera descartes a partir de presupuesto o dormitorios.
Pedir dormitorios tampoco elige una tipología: «prefiero algo de dos dormitorios» conserva category=null y group=residential; incluye departamentos y penthouses compatibles. Una respuesta sobre dormitorios no hereda la categoría de los ejemplos del bot. Una preferencia anterior se conserva en la memoria, no se declara otra vez.
property.operation distingue buscar opciones (search), preguntar cuáles son mayores/menores/baratas (rank), comparar (compare), elegir afirmativamente (select) y pedir detalles (details). «¿Cuál es la opción más grande?» es rank, NO select. «Prefiero la más grande de esas» es select. Un empate se puede mostrar como resultado de una consulta; no obliga al cliente a elegir antes de recibir información.
Responder una pregunta de dormitorios, superficie o planta no elige un tipo de unidad ni excluye otros tipos. El presupuesto puede motivar una recomendación, pero no confirma categoría. Un sí a una invitación entregada para explorar UN solo tipo responde a esa invitación; no selecciona unidad ni acepta reserva o financiamiento. Un sí entre varios tipos sigue sin escoger.
property.filters expresa restricciones actuales: «5ta planta», «quinta planta» y «piso cinco» son floor_number=5; «de5habiataciones» expresa bedrooms=5. Corrija errores evidentes sin inventar datos. Una restricción no es un número de unidad ni una negativa a la pregunta anterior. «No tiene opciones de 5 habitaciones» pregunta disponibilidad, no rechaza presupuesto.
bedrooms_required=true solo si declara indispensable/exacta esa cantidad; false solo si acepta expresamente otra cantidad; null si no expresa esa decisión. No insista con menos dormitorios cuando el requisito es indispensable.
Conserve la comparación de dormitorios: bedrooms es el valor o extremo inferior; bedrooms_operator=eq significa exactamente, gte al menos/mínimo, lte como máximo y between un intervalo inclusivo cuyo extremo superior va en bedrooms_upper. Interprete el significado aunque use otras palabras o errores de escritura. No transforme «mínimo 2» en exactamente 2: admite también 3 o más. «Entre 2 y 4» usa bedrooms=2, bedrooms_operator=between, bedrooms_upper=4. Cite el fragmento actual en filter_evidence para cada campo; bedrooms_upper=null fuera de between. bedrooms_required indica flexibilidad, no sustituye la comparación. Si usa bedrooms_any, deje operador y extremo superior null. Plantas altas expresa preferencia relativa: no invente una planta numérica exacta.
Si admite varias cantidades de dormitorios, conserve todas en bedrooms_any y bedrooms=null; por ejemplo «cinco o seis cuartos» produce [5,6]. Sin alternativas explícitas use bedrooms_any=[]. Distinga alternativas admitidas de cantidades negadas, rangos y números de unidades. No restaure requisitos anteriores si está aceptando alternativas ofrecidas; conserve el referente de la pregunta pendiente.
query_scope=catalog para buscar o consultar máximos sin lista concreta, offered para «de esas opciones», comparison para la comparación activa, selected para la elegida. Preserve null si no aplica. La memoria conserva filtros previos; no los extraiga otra vez como declaraciones nuevas.
pregunta_pendiente.act, target_ids y candidate_ids expresan el foco real. «Sí prefiero esa opción» tras ofrecer detalles del 502 acepta esa oferta sobre 502 aunque antes se mencionara 504; es referencia followup, no explicit. No convierta aceptar detalles o un recorrido en visita, compra o reserva.
Si pregunta_pendiente.act=explore_alternatives, una aceptación permite explorar proposed_query, no elige una unidad ni reemplaza el requisito original. El sistema aplicará esa consulta; no vuelva a extraer dormitorios del historial ni transforme el sí en select. Elegir una categoría (por ejemplo, departamentos entre alternativas residenciales) refina la búsqueda sin borrar dormitorios, planta o superficie ya establecidos. Un sí a una elección entre varias categorías o unidades no identifica una de ellas.
Si pregunta_pendiente.act=explore_quoted_options, aceptar ver detalles continúa con candidate_ids y operation=details; no selecciona una unidad ni repite la consulta de precio anterior. Si además pregunta la diferencia, operation=compare. Si act=confirm_bedrooms, un sí conserva esa cantidad al explorar opciones más económicas; un no no autoriza una cantidad distinta inventada.
Un pedido explícito de menos dormitorios cambia ese requisito aunque antes fuese indispensable. Si no indica una cantidad nueva, no invente bedrooms=2 ni mantenga el número anterior: el catálogo determinará qué cantidades menores existen y el lead elegirá. Si pide exactamente dos dormitorios, conserve dos y no ofrezca suites de uno. Pedir algo más económico sin mencionar dormitorios no autoriza reducirlos: primero se confirma si desea mantener la cantidad conocida. Buscar alternativas es distinto de preguntar cuál de las opciones mostradas es la más económica.
PLANTAS: planta baja es floor_number=0; primera planta alta o primer piso es 1; segunda planta alta es 2. Pisos bajos, plantas inferiores, una planta más baja y plantas altas son preferencias relativas: no invente un número exacto. Conserve su motivo (por ejemplo, evitar gradas) como preferencia cualitativa actual. La comodidad o la existencia de ascensores no confirma accesibilidad ni sustituye la elección. Distinguir una planta preferida de una unidad elegida también aplica cuando sólo hay una unidad en esa planta.
property.reference_kind: explicit si identifica una unidad; comparison si compara varias; relative para "el más grande", "la primera", "el más barato"; followup para continuar una consulta sobre unidades previas ("¿y en precio?"). En relative seleccione selector=largest|smallest|cheapest|most_expensive|first|last según corresponda. Use las opciones que el bot REALMENTE acaba de mostrar, no otra categoría guardada anteriormente. Un empate no permite elegir una unidad.
unit_numbers contiene solo códigos del catálogo realmente referidos. En explicit deben aparecer en el mensaje actual; en comparison/followup pueden proceder de la comparación activa del contexto. Nunca convierta precios, áreas, horas o pisos en números de unidad. En relative no invente un código: el sistema resuelve selector contra las opciones mostradas. Una pregunta "¿y en precio?" tras comparar 202 y 302 se refiere a AMBAS unidades, no a todo el catálogo.
Use confidence=high solo cuando la evidencia literal y el contexto produzcan una única interpretación. No invente intención, unidad, presupuesto ni aceptación.
`

function literalEvidence(value: unknown, current: string) {
  const evidence = text(value).trim()
  // A compound current declaration may need more than 240 characters to retain
  // its negations and corrections. Membership bounds the quote to the actual
  // turn, instead of accepting it at extraction and silently discarding it here.
  if (!evidence) return ''
  return current.normalize('NFKC').toLowerCase().includes(evidence.normalize('NFKC').toLowerCase()) ? evidence : ''
}

/** A missing duplicate boolean quote may reuse a constraint's current evidence.
 * Required catalogue strength alone does not make a bedroom count inflexible. */
/** The model owns the meaning of quantities; normalization only checks its typed,
 * current evidence and keeps people and catalogue constraints in separate domains. */
function normalizedHousingQuantities(raw: unknown, current: string): Row[] {
  if (!Array.isArray(raw)) return []
  return raw.map(object).flatMap(quantity => {
    const evidence = literalEvidence(quantity.evidence, current)
    if (!acceptedExtractorConfidence(quantity.confidence) || !evidence || !housingQuantityDimensions.has(text(quantity.dimension))
      || !housingQuantityRoles.has(text(quantity.role)) || !housingQuantityBases.has(text(quantity.count_basis))) return []
    const values = Array.isArray(quantity.values)
      ? [...new Set(quantity.values.filter(value => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000))] : []
    return [{ dimension: quantity.dimension, values, role: quantity.role, count_basis: quantity.count_basis, evidence, confidence: quantity.confidence }]
  }).slice(0, 12)
}

function householdFromQuantities(quantities: Row[]): Row | null {
  const people = quantities.filter(quantity => quantity.dimension === 'people' && quantity.role !== 'unknown')
  const totals = people.filter(quantity => Array.isArray(quantity.values) && quantity.values.length === 1
    && ['total', 'excluding_speaker'].includes(text(quantity.count_basis)))
    .map(quantity => ({ occupants: Number((quantity.values as number[])[0]) + (quantity.count_basis === 'excluding_speaker' ? 1 : 0), evidence: quantity.evidence, confidence: quantity.confidence }))
  const unique = [...new Set(totals.map(total => total.occupants))]
  return unique.length === 1 ? { occupants: unique[0], evidence: totals.map(total => total.evidence).join('; '),
    confidence: combinedExtractorConfidence(...totals.map(total => total.confidence)) } : null
}

/** Every consumer of current lexical filters must honor the same interpreted
 * dimension; otherwise a second parser can recreate a rejected constraint. */
export function propertyFiltersWithQuantityMeaning(rawFilters: unknown, semantics: unknown): PropertyFilters {
  const filters = normalizedPropertyFilters(rawFilters), data = object(semantics)
  if (!Object.hasOwn(data, 'housing_quantities')) return filters
  const quantities = Array.isArray(data.housing_quantities) ? data.housing_quantities.map(object) : []
  if (!quantities.length) return filters
  const requested = quantities.filter(quantity => quantity.dimension === 'bedrooms' && quantity.role === 'requirement' && acceptedExtractorConfidence(quantity.confidence))
    .flatMap(quantity => Array.isArray(quantity.values) ? quantity.values : [])
  const values = filters.bedrooms_any?.length ? filters.bedrooms_any : filters.bedrooms !== null ? [filters.bedrooms] : []
  if (values.some(value => !requested.includes(value))) {
    filters.bedrooms = null; delete filters.bedrooms_any; filters.bedrooms_required = null
  }
  return filters
}

/** Current, typed model evidence authorizes a request to start; catalogue and execution validate the result separately. */
export function normalizedReservation(raw: unknown, current: string, pendingRaw?: unknown, answerRaw?: unknown, authorityRaw?: unknown): Row {
  const reservation = object(raw)
  const authority = normalizedActionAuthority(authorityRaw, current)
  const authorized = actionAuthorized(authority, 'reservation')
  const evidence = literalEvidence(reservation.evidence, current)
  const valid = acceptedExtractorConfidence(reservation.confidence) && !!evidence && reservationKinds.has(text(reservation.kind)) && reservation.kind !== 'none'
  const result: Row = valid ? { kind: text(reservation.kind), evidence, confidence: reservation.confidence,
    reference_kind: ['explicit', 'contextual', 'none'].includes(text(reservation.reference_kind)) ? reservation.reference_kind : 'none',
    unit_numbers: Array.isArray(reservation.unit_numbers)
      ? [...new Set(reservation.unit_numbers.map(text).filter(code => /^(?:LC-?)?\d{1,4}$/i.test(code)))].slice(0, 12) : [],
  } : { kind: 'none', evidence: null, unit_numbers: [], confidence: 'low' }
  const pending = normalizedPendingQuestion(pendingRaw), answer = object(answerRaw)
  const answerEvidence = literalEvidence(answer.evidence, current)
  // Rebuild this proof from the caller's delivered receipt and current typed
  // answer every time; never preserve a model-supplied accepted_invitation.
  if (authorized && ['none', 'request'].includes(text(result.kind)) && pending.id === 'reservation_invitation'
    && pending.act === 'reservation' && verifiedReservationInvitation(pending.reservation_invitation, pending.target_ids as string[])
    && answer.question_id === pending.id && answer.kind === 'affirmative' && acceptedExtractorConfidence(answer.confidence)
    && answerEvidence && simpleReservationAcceptance(current, answer)
    && Array.isArray(pending.target_ids) && pending.target_ids.length === 1) {
    return { kind: 'request', evidence: answerEvidence, confidence: answer.confidence, unit_numbers: [],
      accepted_invitation: { ...object(pending.reservation_invitation), target_ids: [...pending.target_ids] } }
  }
  return result.kind === 'request' && (!authorized || actionDecision(authority, 'reservation').decision !== 'request'
    || !explicitReservationAction(text(result.evidence), result))
    ? { kind: 'none', evidence: null, unit_numbers: [], confidence: 'low' } : result
}

/**
 * Compatibility classifier for replies already sent before question memory was
 * introduced. New turns persist the returned id explicitly in the summary.
 */
/** Legacy prose has no authority to recreate a delivered question receipt. */
export function pendingQuestionFromReply(_reply: string): Row { void _reply;  return {} }

export function normalizeTurnSemantics(raw: unknown, current: string, pendingRaw: unknown, monetaryReferences: Row[] = []): Row {
  const data = object(object(raw).turn_semantics)
  const choice = object(data.unit_choice), choiceEvidence = literalEvidence(choice.evidence, current)
  const choiceValid = acceptedExtractorConfidence(choice.confidence) && !!choiceEvidence
    && ['selected', 'conditional', 'rejected'].includes(text(choice.kind))
  const categoryChoice=object(data.category_choice),categoryChoiceEvidence=literalEvidence(categoryChoice.evidence,current)
  const categoryChoiceValid=acceptedExtractorConfidence(categoryChoice.confidence)&&!!categoryChoiceEvidence
    && ['selected','conditional'].includes(text(categoryChoice.kind))&&propertyCategories.has(text(categoryChoice.category))
  const pending = normalizedPendingQuestion(pendingRaw)
  const pendingId = questionIds.includes(text(pending.id) as PendingQuestionId) ? text(pending.id) : ''
  const primaryEvidence = literalEvidence(data.primary_evidence, current)
  const extractedPrimaryIntent = acceptedExtractorConfidence(data.confidence) && primaryEvidence && primaryIntents.has(text(data.primary_intent))
    ? text(data.primary_intent) : 'other'
  const answer = object(data.answer_to_previous)
  const answerEvidence = literalEvidence(answer.evidence, current)
  const answerQuestionId = acceptedExtractorConfidence(answer.confidence) && answerEvidence && pendingId
    && text(answer.question_id) === pendingId && answerKinds.has(text(answer.kind)) && answer.kind !== 'none'
    ? pendingId : ''
  const reservation = normalizedReservation(data.reservation, current, pending, answer, object(raw).action_authority)
  const decisions: Row[] = []
  // A validated affirmative belongs to its delivered operational invitation.
  // Merely liking a unit, accepting details, an ambiguous alternative, or a
  // conditional answer cannot initiate this handoff. Inventory is checked later.
  if (reservation.accepted_invitation) {
    decisions.push({ code: 'delivered_reservation_invitation_accepted', source: 'answer_to_previous',
      evidence: answerEvidence, target_ids: pending.target_ids })
  }
  const reservationIntent = reservation.kind === 'request' ? 'request_reservation' : reservation.kind === 'information' ? 'ask_reservation' : null
  const primaryIntent = reservationIntent || (['request_reservation', 'ask_reservation'].includes(extractedPrimaryIntent) ? 'other' : extractedPrimaryIntent)
  if (reservationIntent && reservationIntent !== extractedPrimaryIntent) decisions.push({ code: 'current_reservation_takes_priority',
    extractor_intent: extractedPrimaryIntent, canonical_intent: reservationIntent, source: 'reservation', evidence: reservation.evidence })
  if (!reservationIntent && ['request_reservation', 'ask_reservation'].includes(extractedPrimaryIntent)) decisions.push({ code: 'reservation_intent_without_current_action_evidence',
    extractor_intent: extractedPrimaryIntent, canonical_intent: primaryIntent, source: 'reservation' })

  const budget = object(data.budget)
  const budgetEvidence = literalEvidence(budget.evidence, current)
  const budgetStatus = acceptedExtractorConfidence(budget.confidence) && budgetEvidence && budgetStatuses.has(text(budget.status))
    && budget.status !== 'not_discussed' ? text(budget.status) : 'not_discussed'
  const amount = budgetAmountForCurrentTurn(object(raw), current, pending, monetaryReferences)
  const property = object(data.property)
  const propertyEvidence = literalEvidence(property.evidence, current)
  const propertyConfident = acceptedExtractorConfidence(property.confidence) && !!propertyEvidence
  const excluded = propertyConfident && Array.isArray(property.excluded_categories) ? [...new Set(property.excluded_categories.map(text).filter(category => propertyCategories.has(category)))] : []
  const category = propertyConfident && propertyCategories.has(text(property.category)) && !excluded.includes(text(property.category))
    ? text(property.category) : null
  const normalizationIssues: string[] = []
  const housingQuantities = normalizedHousingQuantities(data.housing_quantities, current)
  const hasQuantityContract = Object.hasOwn(data, 'housing_quantities')
  const group = category === 'local' ? 'commercial' : category ? 'residential'
    : propertyConfident && ['residential', 'commercial'].includes(text(property.group)) ? text(property.group) : null
  const filterEvidence = Object.fromEntries(Object.entries(object(property.filter_evidence))
    .map(([key, evidence]) => [key, propertyConfident ? literalEvidence(evidence, current) : '']))
  const filters = propertyConfident ? normalizedPropertyFilters(property.filters) : emptyPropertyFilters()
  for (const key of Object.keys(filters) as (keyof PropertyFilters)[]) {
    if (filters[key] != null && !filterEvidence[key]) {
      delete filters[key]
      normalizationIssues.push('property_filter_without_current_evidence:' + key)
    }
  }
  Object.assign(filters, normalizedPropertyFilters(filters))
  // Preserve the interpreter's numeric role. A people/context or suitability
  // count cannot become a new bedroom requirement in a downstream consumer.
  const quantityFilters = propertyFiltersWithQuantityMeaning(filters, { housing_quantities: housingQuantities })
  if ((filters.bedrooms !== quantityFilters.bedrooms)
    || JSON.stringify(filters.bedrooms_any) !== JSON.stringify(quantityFilters.bedrooms_any))
    normalizationIssues.push('bedroom_filter_without_bedroom_requirement')
  Object.assign(filters, quantityFilters)
  if (!quantityFilters.bedrooms_any?.length) delete filters.bedrooms_any
  const selector = propertyConfident && unitSelectors.has(text(property.selector)) ? text(property.selector) : null
  let operation = propertyConfident && operations.has(text(property.operation)) ? text(property.operation) : 'none'
  const hasUnit = Array.isArray(property.unit_numbers) && property.unit_numbers.length > 0
  if (operation === 'select' && !hasUnit && !selector && !['relative', 'followup'].includes(text(property.reference_kind))) {
    operation = 'search'; normalizationIssues.push('constraint_does_not_select_unit')
  }
  const queryScope = propertyConfident && queryScopes.has(text(property.query_scope)) ? text(property.query_scope) : null

  return {
    action_authority: normalizedActionAuthority(object(raw).action_authority, current),
    primary_intent: primaryIntent,
    primary_evidence: primaryIntent === 'other' ? null : reservationIntent ? reservation.evidence : primaryEvidence,
    confidence: primaryIntent === 'other' ? 'low' : reservationIntent ? reservation.confidence : data.confidence,
    reservation,
    interaction_goal: normalizedInteractionGoal(data.interaction_goal, current),
    ...(data.nurture_request !== undefined ? { nurture_request: normalizedNurtureRequest(data.nurture_request, current) } : {}),
    selection_preferences: normalizedSelectionPreferences(data.selection_preferences, current),
    unit_choice: choiceValid ? { kind: choice.kind, evidence: choiceEvidence, confidence: choice.confidence,
      unit_numbers: Array.isArray(choice.unit_numbers) ? choice.unit_numbers.map(text).filter(number => /^(?:LC-?)?\d{1,4}$/i.test(number)) : [] }
      : { kind: 'none', evidence: null, confidence: 'low', unit_numbers: [] },
    category_choice:categoryChoiceValid?{kind:categoryChoice.kind,category:categoryChoice.category,evidence:categoryChoiceEvidence,confidence:categoryChoice.confidence}
      :{kind:'none',category:null,evidence:null,confidence:'low'},
    preference_change: acceptedExtractorConfidence(object(data.preference_change).confidence)
      && literalEvidence(object(data.preference_change).evidence, current)
      ? object(data.preference_change) : { kind: 'none', bedrooms: null, bedroom_decision: 'unspecified', evidence: '', confidence: 'low' },
    ...(data.discount_request !== undefined ? { discount_request: normalizedDiscountRequest(data.discount_request, current) } : {}),
    ...(hasQuantityContract ? { housing_quantities: housingQuantities, household: householdFromQuantities(housingQuantities) } : {}),
    interpretation: { extractor_primary_intent: extractedPrimaryIntent, canonical_primary_intent: primaryIntent, decisions },
    property: {
      group, category, excluded_categories: excluded, operation, filters, query_scope: queryScope,
      ...(property.filter_evidence !== undefined ? { filter_evidence: filterEvidence } : {}),
      reference_kind: propertyConfident && referenceKinds.has(text(property.reference_kind)) ? text(property.reference_kind) : 'none',
      unit_numbers: propertyConfident && Array.isArray(property.unit_numbers)
        ? [...new Set(property.unit_numbers.map(text).filter(value => /^(?:LC-?)?\d{1,4}$/i.test(value)))].slice(0, 12) : [],
      selector,
      evidence: propertyConfident ? propertyEvidence : null, confidence: propertyConfident ? property.confidence : 'low',
    },
    answer_to_previous: answerQuestionId ? {
      question_id: answerQuestionId,
      kind: text(answer.kind),
      evidence: answerEvidence,
      confidence: answer.confidence,
    } : { question_id: null, kind: 'none', evidence: null, confidence: 'low' },
    budget: budgetStatus === 'not_discussed' ? {
      status: 'not_discussed', amount: null, evidence: null, confidence: 'low',
    } : { status: budgetStatus, amount, evidence: budgetEvidence, confidence: budget.confidence,
      ...(['total_budget', 'down_payment'].includes(text(budget.subject)) ? { subject: budget.subject } : {}),
      ...(budget.amount_reference_id != null ? { amount_reference_id: budget.amount_reference_id } : {}) },
    normalization_issues: normalizationIssues,
  }
}

export function answersPendingQuestion(semantics: unknown, questionId: PendingQuestionId, kind?: string) {
  const answer = object(object(semantics).answer_to_previous)
  return acceptedExtractorConfidence(answer.confidence) && answer.question_id === questionId && (!kind || answer.kind === kind)
}

export function semanticBudgetStatus(semantics: unknown) {
  const budget = object(object(semantics).budget)
  return acceptedExtractorConfidence(budget.confidence) && budgetStatuses.has(text(budget.status)) ? text(budget.status) : 'not_discussed'
}
