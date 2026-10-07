import { object, text, type Row } from './data'
import { bedroomComparison, type BedroomComparison } from './bedroom-comparison'
import { normalized } from './sdr-rules'
import { bedroomOptions, bedroomOptionsFromText } from './bedroom-options'
import { normalizeCatalogRequest } from './catalog-request'
import { replyQuestions } from './reply-question'
import { budgetAmountWithLiteralQuantity } from './turn-interpretation-input'

export const questionIds = [
  'reservation_invitation',
  'financing_invitation',
  'financing_partner',
  'financing_data',
  'property_purpose',
  'visit_invitation',
  'visit_destination',
  'visit_date_time',
  'budget_amount',
  'budget_kind',
  'property_category',
  'property_floor',
  'property_bedrooms',
  'property_area',
  'property_requirements',
  'unit_choice',
  'purchase_timing',
  'lead_profile',
  'lead_profile_name',
  'lead_profile_residence',
  'lead_residence_confirmation',
  'brochure_offer',
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
const propertyCategories = new Set(['suite', 'departamento', 'penthouse', 'local'])
const referenceKinds = new Set(['none', 'explicit', 'relative', 'comparison', 'followup'])
const unitSelectors = new Set(['largest', 'smallest', 'cheapest', 'most_expensive', 'first', 'last'])
const operations = new Set(['search', 'rank', 'compare', 'select', 'details', 'none'])
const queryScopes = new Set(['catalog', 'offered', 'comparison', 'selected'])
export const questionActs = new Set(['choose_unit', 'confirm_unit', 'show_unit_details', 'explore_quoted_options', 'choose_category', 'choose_floor', 'explore_alternatives', 'confirm_bedrooms', 'budget', 'visit', 'profile', 'reservation', 'financing', 'material', 'other'])
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
  housing_quantities: { type: 'array', description: 'Solo cantidades declaradas o evaluadas en mensaje_actual; [] si no hay. Nunca copie cantidades del catálogo, de una pregunta previa ni del historial. No cree elementos vacíos.', items: strictObject({ dimension: enumSchema(housingQuantityDimensions),
    values: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 1000 } },
    role: { ...enumSchema(housingQuantityRoles), description: 'requirement busca/restringe; evaluation consulta si las opciones sirven; context describe la familia; unknown es ambiguo. Evaluar capacidad no impone otra búsqueda.' }, count_basis: enumSchema(housingQuantityBases), evidence: { type: 'string' }, confidence: confidenceSchema }) },
  answer_to_previous: strictObject({ question_id: enumSchema([...questionIds, 'none']), kind: enumSchema(answerKinds), evidence: { type: 'string' }, confidence: confidenceSchema }),
  reservation: strictObject({ kind: enumSchema(reservationKinds), evidence: { type: 'string' },
    unit_numbers: { type: 'array', items: { type: 'string' } }, confidence: confidenceSchema }),
  property: strictObject({
    group: nullableEnumSchema(['residential', 'commercial']), category: nullableEnumSchema(propertyCategories),
    excluded_categories: { type: 'array', items: enumSchema(propertyCategories) }, operation: enumSchema(operations),
    reference_kind: enumSchema(referenceKinds), unit_numbers: { type: 'array', items: { type: 'string' } },
    selector: nullableEnumSchema(unitSelectors), query_scope: nullableEnumSchema(queryScopes),
    filters: strictObject({ floor_number: { type: ['integer', 'null'] }, bedrooms: { type: ['integer', 'null'] }, bedrooms_any: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 30 } }, bedrooms_operator: { type: ['string', 'null'], enum: ['eq', 'gte', 'lte', 'between', null] }, bedrooms_upper: { type: ['integer', 'null'], minimum: 1, maximum: 30 }, bedrooms_required: { type: ['boolean', 'null'] }, min_area_m2: { type: ['number', 'null'] }, max_area_m2: { type: ['number', 'null'] } }),
    filter_evidence: strictObject(Object.fromEntries(['floor_number', 'bedrooms', 'bedrooms_any', 'bedrooms_operator', 'bedrooms_upper', 'bedrooms_required', 'min_area_m2', 'max_area_m2'].map(key => [key, { type: 'string' }]))),
    evidence: { type: 'string' }, confidence: confidenceSchema,
  }),
  budget: strictObject({ status: enumSchema(budgetStatuses), amount: { type: ['number', 'null'] }, evidence: { type: 'string' }, confidence: confidenceSchema }),
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

const numberWords: Record<string, number> = { cero: 0, un: 1, una: 1, uno: 1, primera: 1, primer: 1, dos: 2, segunda: 2, segundo: 2, tres: 3, tercera: 3, tercer: 3, cuatro: 4, cuarta: 4, cuarto: 4, cinco: 5, quinta: 5, quinto: 5, seis: 6, sexta: 6, sexto: 6, siete: 7, septima: 7, septimo: 7, ocho: 8, octava: 8, octavo: 8, nueve: 9, novena: 9, noveno: 9, diez: 10, decima: 10, decimo: 10 }
const numberToken = '(?:\\d{1,2}(?:ta|to|ra|ro|da|do|ma|mo|va|vo)?|' + Object.keys(numberWords).join('|') + ')'
// Before/after a floor noun, un/una are indefinite articles ("un piso
// exacto"), not evidence that the customer chose the first floor. "Uno",
// ordinals and actual digits retain their numeric meanings.
const floorNumberToken = '(?:\\d{1,2}(?:ta|to|ra|ro|da|do|ma|mo|va|vo)?|'
  + Object.keys(numberWords).filter(word => !['un', 'una'].includes(word)).join('|') + ')'
const tokenNumber = (value: string) => numberWords[value] ?? Number.parseInt(value, 10)

/** Conservative spelling compatibility; model values still carry the original evidence. */
export function propertyFiltersFromText(current: string, pendingId = ''): PropertyFilters {
  const value = normalized(current).replace(/(?<![a-z])(?:habiataciones|habitacones|abitaciones)\b/g, 'habitaciones')
  const filters = emptyPropertyFilters()
  const floor = value.match(new RegExp('\\b(?:planta|piso|nivel)\\s*(?:numero\\s*)?(' + floorNumberToken + ')\\b'))
    || value.match(new RegExp('\\b(' + floorNumberToken + ')\\s*(?:planta|piso|nivel)\\b'))
    || (pendingId === 'property_floor' ? value.match(new RegExp('^(?:la |el )?(' + floorNumberToken + ')$')) : null)
  if (floor) filters.floor_number = tokenNumber(floor[1])
  if (/\bplanta baja\b/.test(value)) filters.floor_number = 0
  const bedrooms = value.match(new RegExp('(?:^|[^a-z0-9])(?:de\\s*)?(' + numberToken + ')\\s*(?:dormitorios?|habitaciones?|cuartos?)\\b'))
  if (bedrooms) filters.bedrooms = tokenNumber(bedrooms[1])
  const choices = bedroomOptionsFromText(current)
  if (choices.length > 1) { filters.bedrooms = null; filters.bedrooms_any = choices }
  if (bedrooms && !/\bno (?:es|son|necesito|necesariamente|tienen que ser)\b/.test(value)
    && (/\b(?:exactamente|indispensables?|obligatori[oa]s?|obligatoriamente|necesariamente)\b/.test(value)
      || /\b(?:menos|otra cantidad)\b.{0,25}\bno me sirve\b|\bno (?:acepto|quiero) menos\b/.test(value))) filters.bedrooms_required = true
  const area = value.match(/\b(al menos|minimo|desde|hasta|maximo|menos de|mas de)\s*(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros)/)
  if (area) filters[/hasta|maximo|menos de/.test(area[1]) ? 'max_area_m2' : 'min_area_m2'] = Number(area[2].replace(',', '.'))
  return normalizedPropertyFilters(filters)
}

/** A request to change options is distinct from ranking the options already shown. */
export function propertyPreferenceChange(current: string, previousQuery: unknown, semantics?: unknown): Row {
  const value = normalized(current)
  const previous = normalizedPropertyFilters(object(previousQuery).filters)
  const previousBedrooms = previous.bedrooms ?? (previous.bedrooms_any?.length ? Math.min(...previous.bedrooms_any) : null)
  const bedrooms = propertyFiltersWithQuantityMeaning(propertyFiltersFromText(current), semantics).bedrooms
  const fewer = /\b(?:menos|menor cantidad de|menor numero de)\s+(?:dormitorios?|habitaciones?|cuartos?)\b/.test(value)
    && !/\bno\s+(?:quiero|deseo|acepto|busco|necesito)\s+(?:algo\s+con\s+)?menos\b|\bmenos\s+(?:dormitorios?|habitaciones?|cuartos?)\s+no\b/.test(value)
  const cheaper = /\b(?:mas\s+(?:economic[oa]s?|barat[oa]s?|accesibles?)|menor\s+precio|precio\s+mas\s+bajo)\b/.test(value)
    && !/\b(?:cual(?:es)? (?:es|son)|que opcion es)\b/.test(value)
    && !/^(?:(?:prefiero|quiero|elijo|escojo) )?(?:el|la) mas (?:barat[oa]|economic[oa])(?: de es[at][oa]s)?$/.test(value)
    && !/\b(?:cual|cuales|la|el)\b[^.!?]{0,35}\b(?:mas\s+(?:economic[oa]s?|barat[oa]s?)|menor\s+precio)\b[^.!?]{0,20}\b(?:de es[at]as|entre es[at]as)\b/.test(value)
    && !/\bno\s+(?:quiero|deseo|busco|necesito)\s+(?:algo\s+)?mas\s+(?:economic|barat)/.test(value)
    && !/\bno\s+(?:algo\s+)?mas\s+(?:economic|barat|accesible)/.test(value)
  const reducingCount = bedrooms !== null && previousBedrooms !== null && bedrooms < previousBedrooms
  const fewerBedrooms = fewer || reducingCount
  const kind = cheaper ? 'cheaper' : fewerBedrooms ? 'fewer_bedrooms' : null
  return { kind, bedrooms, previous_bedrooms: previousBedrooms, fewer_bedrooms: fewerBedrooms,
    requires_bedroom_confirmation: kind === 'cheaper' && bedrooms === null && !fewerBedrooms,
    evidence: kind ? current.trim().slice(0, 240) : '' }
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
  return { id, act: questionActs.has(text(row.act)) ? text(row.act) : id === 'unit_choice' ? 'choose_unit' : id === 'property_floor' ? 'choose_floor'
    : id === 'property_category' ? 'choose_category' : id === 'reservation_invitation' ? 'reservation' : id === 'brochure_offer' ? 'material'
    : id.startsWith('financing') ? 'financing' : id.startsWith('budget') ? 'budget' : id.startsWith('visit') ? 'visit' : 'other',
  question: text(row.question).trim().slice(0, 500), target_ids: ids(row.target_ids), candidate_ids: ids(row.candidate_ids),
  ...(Object.keys(proposedQuery).length ? { proposed_query: { ...proposedQuery, operation: 'search', selector: null } } : {}) }
}

export const TURN_SEMANTIC_EXTRACTION_RULES = `
Devuelva SIEMPRE turn_semantics conforme al esquema JSON estricto adjunto; sus campos, tipos y valores permitidos se definen allí.
Interprete el mensaje actual junto con historial_reciente y pregunta_pendiente. El historial aclara referencias como "sí", "esa", "ese precio" o "no estoy seguro", pero la evidencia siempre debe copiar palabras del mensaje ACTUAL.
reservation distingue la intención de iniciar la separación/reserva (request), consultar condiciones o requisitos sin iniciar (information), rechazar o posponer ese proceso (declined) y ausencia de esa intención (none). «Quiero separar el 605», «ayúdeme a iniciar la reserva de esa unidad» y sus errores evidentes de escritura son request; «¿cuánto se paga para reservar?» o «¿cómo funciona la separación?» son information. «Por ahora no, entonces quiero separar el departamento 605» responde negativamente a la propuesta anterior y pide una reserva NUEVA: conserve answer_to_previous y use primary_intent=request_reservation, reservation.kind=request. La unidad mencionada identifica el objeto de la reserva, no convierte el turno en una nueva presentación ni en un recorrido. Copie evidencia literal de la petición completa, incluidas negaciones, condiciones y correcciones relevantes; no cite solo el verbo de una frase negada. Una reserva hipotética o condicionada no satisfecha no inicia el trámite. primary_intent=ask_reservation para information. El evento asked_reservation sirve para puntuar interés, nunca demuestra por sí solo que desea iniciar ahora. unit_numbers conserva los códigos realmente referidos y el catálogo comprobará su existencia; en referencias como «esa» puede usar una unidad inequívoca del contexto, nunca elegir entre varias. Solicitar el proceso requiere atención del asesor; no afirma disponibilidad, pago, reserva confirmada, cita, consentimiento financiero ni asesor asignado. No convierta la aceptación de detalles, una cifra de precio, un «sí» sin pregunta de reserva ni el historial en una solicitud nueva.
En property.filters declare únicamente restricciones expresadas en el mensaje ACTUAL y copie en filter_evidence la frase literal que sustenta cada campo; deje vacío el resto. Las características de unidades ya ofrecidas pertenecen al contexto, no son filtros nuevos. Para comparar, pedir detalles o clasificar esas opciones, use operation, reference_kind, query_scope y unit_numbers; no repita sus dormitorios, planta o áreas como restricciones actuales. Una nueva restricción sí puede refinar el conjunto referido y necesita su propia evidencia, aunque esté expresada de forma natural y sin cifras.
Antes de fijar dormitorios, interprete el significado de cada cantidad relevante en housing_quantities. dimension=people cuenta ocupantes/familiares; bedrooms cuenta dormitorios; unknown conserva una cantidad cuyo objeto no se puede resolver. Nunca convierta personas en dormitorios ni deduzca cuartos por ocupante. values contiene las cantidades expresadas (también en palabras) y queda [] si no hay una cantidad conocida. Para personas use count_basis=total si la cifra incluye al hablante, excluding_speaker si explícitamente lo excluye, unspecified si no se sabe; el sistema suma uno únicamente en excluding_speaker. «Somos seis» es people [6] total; «es para mi familia, unas cinco sin contar conmigo» es people [5] excluding_speaker, NO bedrooms=5. «Somos varios» conserva people [] unspecified. Si hay una corrección, conserve la cantidad corregida con la evidencia que la distingue; no sume familiares o cifras que puedan solaparse.
role=requirement expresa una restricción solicitada; evaluation pregunta si las opciones o su distribución sirven al cliente; context describe su situación sin imponer un filtro. Un número de dormitorios en property.filters debe corresponder a housing_quantities con dimension=bedrooms y role=requirement. «Somos seis y busco tres cuartos» separa people [6] context de bedrooms [3] requirement. «¿Alcanzarán tres dormitorios para una familia de seis?» separa bedrooms [3] evaluation y people [6] context: no introduce una nueva búsqueda, conserva las opciones ofrecidas con operation=details y reference_kind=followup cuando existan. Puede orientar sobre esas distribuciones sin volver a preguntar cuántos dormitorios quiere. Una respuesta numérica a la pregunta pendiente de dormitorios sí puede ser requirement aunque no repita el sustantivo. La evidencia debe conservar el contexto que distingue las cantidades, no solo una cifra aislada. No rellene cantidades a partir del historial. Use [] cuando este turno no declare ni evalúe cantidades de vivienda.
Resuelva primero sobre QUÉ pide información. Una solicitud general tras solo saludos es primary_intent=project_information y property.operation=none, aunque tenga errores de escritura. Con una unidad o alternativas activas, «quiero información», «sí, envíeme detalles» o «¿y los precios?» continúan ese referente: use details, followup y el alcance correspondiente; no reinicie la presentación ni busque todo el catálogo. Una petición explícita de información general del proyecto cambia el tema. Si hay varias solicitudes, conserve todas; si el referente es ambiguo, no invente una unidad. Aceptar explorar alternativas no elimina la necesidad original, pero la búsqueda activa debe seguir las alternativas propuestas, no repetir el filtro sin resultados.
Distinga necesidad original de consulta activa: «como le mencioné necesito cinco, pero quiero saber de los de tres dormitorios» conserva cinco como necesidad contextual y solicita detalles de las alternativas de tres. catalog_request debe limitar esta consulta a tres, no exigir simultáneamente cinco. Consultar esas alternativas autoriza conocerlas, no declara que resuelvan la necesidad ni elige tipo o unidad. Una consulta de precio o recorrido conserva la decisión comercial pendiente; responder que busca vivir captura el uso sin reiniciar dormitorios ni tipos. «Bueno, gracias» sin aceptación inequívoca no cambia la propuesta.
answer_to_previous solo puede usar el question_id exacto recibido en pregunta_pendiente. Si no responde esa pregunta, use question_id=none y kind=none.
Las preguntas lead_profile, lead_profile_name y lead_profile_residence recogen nombre y/o residencia; lead_residence_confirmation confirma si residence_candidate es la residencia actual. Una respuesta «sí» a esa confirmación es affirmative SOLO de lead_residence_confirmation, nunca acepta una visita, crédito o unidad. «No, vivo en otra ciudad» puede contestar negative y aportar la residencia explícita al perfil. El lugar candidato y su evidencia pertenecen al perfil, no al catálogo: nunca los convierta en unit_numbers, filtros o una propiedad seleccionada. Cuando no hay una pregunta de confirmación con candidato registrado, un «sí» aislado no declara una ciudad. Una respuesta al perfil puede además traer otra consulta; preserve ambas sin inventar autorización operativa.
Una aceptación de una invitación a visita, incluso "sí está bien", es affirmative de visit_invitation. Una fecha u hora dada como respuesta es value de visit_date_time.
En budget, no_defined_budget significa que declara no tener presupuesto definido («todavía no tengo uno», «no he establecido cuánto»). amount_pending significa que confirma tener presupuesto sin decir cuánto («sí tengo» ante esa pregunta). unknown conserva una duda o importe ambiguo; not_discussed significa que este turno no declara presupuesto. No confunda estos estados. sufficient_for_selected_unit significa que afirma que el precio de la unidad elegida sí se ajusta a su presupuesto; insufficient_for_selected_unit afirma lo contrario. No convierta una simple aceptación, una cifra del precio citada por el bot ni una duda en capacidad de pago.
Con pregunta_pendiente.id=reservation_invitation un sí inequívoco solicita iniciar esa reserva: reservation.kind=request, evidencia literal del sí y las unidades de target_ids; un no es declined. Con financing_invitation, «bueno continuemos» acepta continuar la orientación financiera, nunca una visita o un asesor. Conserve answer_to_previous con su id exacto. No asigne un significado distinto cuando la pregunta tiene alternativas ambiguas.
amount se completa solo con una cifra expresada por el cliente en el mensaje actual. No copie cifras del historial.
property.category solo indica una preferencia AFIRMADA AHORA: suite|departamento|penthouse|local, no la última categoría mencionada ni una inferencia del historial. En "me interesan más los departamentos porque los penthouse deben ser muy caros", category=departamento y excluded_categories=[penthouse]. Mencionar una opción para descartarla no es elegirla. Una preocupación por precios no declara un presupuesto.
property.group distingue residential (vivienda en general) de commercial (locales). «Me interesa vivienda» y «algo para vivir» son group=residential, category=null: no implican elegir departamento ni excluir suites. Solo complete category si el mensaje realmente elige o consulta esa categoría concreta.
Pedir dormitorios tampoco elige una tipología: «prefiero algo de dos dormitorios» conserva category=null y group=residential; incluye departamentos y penthouses compatibles. Una respuesta sobre dormitorios no hereda la categoría de los ejemplos del bot. Una preferencia anterior se conserva en la memoria, no se declara otra vez.
property.operation distingue buscar opciones (search), preguntar cuáles son mayores/menores/baratas (rank), comparar (compare), elegir afirmativamente (select) y pedir detalles (details). «¿Cuál es la opción más grande?» es rank, NO select. «Prefiero la más grande de esas» es select. Un empate se puede mostrar como resultado de una consulta; no obliga al cliente a elegir antes de recibir información.
property.filters expresa restricciones actuales: «5ta planta», «quinta planta» y «piso cinco» son floor_number=5; «de5habiataciones» expresa bedrooms=5. Corrija errores evidentes sin inventar datos. Una restricción no es un número de unidad ni una negativa a la pregunta anterior. «No tiene opciones de 5 habitaciones» pregunta disponibilidad, no rechaza presupuesto.
bedrooms_required=true solo si declara indispensable/exacta esa cantidad; false solo si acepta expresamente otra cantidad; null si no expresa esa decisión. No insista con menos dormitorios cuando el requisito es indispensable.
Conserve la comparación de dormitorios: bedrooms es el valor o extremo inferior; bedrooms_operator=eq significa exactamente, gte al menos/mínimo, lte como máximo y between un intervalo inclusivo cuyo extremo superior va en bedrooms_upper. Interprete el significado aunque use otras palabras o errores de escritura. No transforme «mínimo 2» en exactamente 2: admite también 3 o más. «Entre 2 y 4» usa bedrooms=2, bedrooms_operator=between, bedrooms_upper=4. Cite el fragmento actual en filter_evidence para cada campo; bedrooms_upper=null fuera de between. bedrooms_required indica flexibilidad, no sustituye la comparación. Si usa bedrooms_any, deje operador y extremo superior null. Plantas altas expresa preferencia relativa: no invente una planta numérica exacta.
Si admite varias cantidades de dormitorios, conserve todas en bedrooms_any y bedrooms=null; por ejemplo «cinco o seis cuartos» produce [5,6]. Sin alternativas explícitas use bedrooms_any=[]. Distinga alternativas admitidas de cantidades negadas, rangos y números de unidades. No restaure requisitos anteriores si está aceptando alternativas ofrecidas; conserve el referente de la pregunta pendiente.
query_scope=catalog para buscar o consultar máximos sin lista concreta, offered para «de esas opciones», comparison para la comparación activa, selected para la elegida. Preserve null si no aplica. La memoria conserva filtros previos; no los extraiga otra vez como declaraciones nuevas.
pregunta_pendiente.act, target_ids y candidate_ids expresan el foco real. «Sí prefiero esa opción» tras ofrecer detalles del 502 acepta esa oferta sobre 502 aunque antes se mencionara 504; es referencia followup, no explicit. No convierta aceptar detalles o un recorrido en visita, compra o reserva.
Si pregunta_pendiente.act=explore_alternatives, una aceptación permite explorar proposed_query, no elige una unidad ni reemplaza el requisito original. El sistema aplicará esa consulta; no vuelva a extraer dormitorios del historial ni transforme el sí en select. Elegir una categoría (por ejemplo, departamentos entre alternativas residenciales) refina la búsqueda sin borrar dormitorios, planta o superficie ya establecidos. Un sí a una elección entre varias categorías o unidades no identifica una de ellas.
Si pregunta_pendiente.act=explore_quoted_options, aceptar ver detalles continúa con candidate_ids y operation=details; no selecciona una unidad ni repite la consulta de precio anterior. Si además pregunta la diferencia, operation=compare. Si act=confirm_bedrooms, un sí conserva esa cantidad al explorar opciones más económicas; un no no autoriza una cantidad distinta inventada.
Un pedido explícito de menos dormitorios cambia ese requisito aunque antes fuese indispensable. Si no indica una cantidad nueva, no invente bedrooms=2 ni mantenga el número anterior: el catálogo determinará qué cantidades menores existen y el lead elegirá. Si pide exactamente dos dormitorios, conserve dos y no ofrezca suites de uno. Pedir algo más económico sin mencionar dormitorios no autoriza reducirlos: primero se confirma si desea mantener la cantidad conocida. Buscar alternativas es distinto de preguntar cuál de las opciones mostradas es la más económica.
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
  return normalized(current).includes(normalized(evidence)) ? evidence : ''
}

/** A missing duplicate boolean quote may reuse a constraint's current evidence.
 * Required catalogue strength alone does not make a bedroom count inflexible. */
function sharedBedroomRigidityEvidence(requirement: Row | null, quantities: Row[], current: string): string {
  if (!requirement || !['eq', 'gte', 'lte', 'between'].includes(text(requirement.operator))) return ''
  const evidence = literalEvidence(requirement.evidence, current)
  const declaration = current.replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, '')
  if (!evidence || !normalized(declaration).includes(normalized(evidence))) return ''
  const lexical = propertyFiltersFromText(evidence)
  if (lexical.bedrooms_required !== true || lexical.bedrooms !== requirement.value) return ''
  const compatibleQuantity = quantities.some(quantity => quantity.dimension === 'bedrooms'
    && quantity.role === 'requirement' && quantity.confidence === 'high'
    && Array.isArray(quantity.values) && quantity.values.includes(requirement.value)
    && (normalized(evidence).includes(normalized(text(quantity.evidence)))
      || normalized(text(quantity.evidence)).includes(normalized(evidence))))
  return compatibleQuantity ? evidence : ''
}

/** The model owns the meaning of quantities; normalization only checks its typed,
 * current evidence and keeps people and catalogue constraints in separate domains. */
function normalizedHousingQuantities(raw: unknown, current: string): Row[] {
  if (!Array.isArray(raw)) return []
  return raw.map(object).flatMap(quantity => {
    const evidence = literalEvidence(quantity.evidence, current)
    if (quantity.confidence !== 'high' || !evidence || !housingQuantityDimensions.has(text(quantity.dimension))
      || !housingQuantityRoles.has(text(quantity.role)) || !housingQuantityBases.has(text(quantity.count_basis))) return []
    const values = Array.isArray(quantity.values)
      ? [...new Set(quantity.values.filter(value => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000))] : []
    return [{ dimension: quantity.dimension, values, role: quantity.role, count_basis: quantity.count_basis, evidence, confidence: 'high' }]
  }).slice(0, 12)
}

function householdFromQuantities(quantities: Row[]): Row | null {
  const people = quantities.filter(quantity => quantity.dimension === 'people' && quantity.role !== 'unknown')
  const totals = people.filter(quantity => Array.isArray(quantity.values) && quantity.values.length === 1
    && ['total', 'excluding_speaker'].includes(text(quantity.count_basis)))
    .map(quantity => ({ occupants: Number((quantity.values as number[])[0]) + (quantity.count_basis === 'excluding_speaker' ? 1 : 0), evidence: quantity.evidence }))
  const unique = [...new Set(totals.map(total => total.occupants))]
  return unique.length === 1 ? { occupants: unique[0], evidence: totals.map(total => total.evidence).join('; '), confidence: 'high' } : null
}

/** Every consumer of current lexical filters must honor the same interpreted
 * dimension; otherwise a second parser can recreate a rejected constraint. */
export function propertyFiltersWithQuantityMeaning(rawFilters: unknown, semantics: unknown): PropertyFilters {
  const filters = normalizedPropertyFilters(rawFilters), data = object(semantics)
  if (!Object.hasOwn(data, 'housing_quantities')) return filters
  const quantities = Array.isArray(data.housing_quantities) ? data.housing_quantities.map(object) : []
  const requested = quantities.filter(quantity => quantity.dimension === 'bedrooms' && quantity.role === 'requirement' && quantity.confidence === 'high')
    .flatMap(quantity => Array.isArray(quantity.values) ? quantity.values : [])
  const values = filters.bedrooms_any?.length ? filters.bedrooms_any : filters.bedrooms !== null ? [filters.bedrooms] : []
  if (values.some(value => !requested.includes(value))) {
    filters.bedrooms = null; delete filters.bedrooms_any; filters.bedrooms_required = null
  }
  return filters
}

/** Current, typed model evidence authorizes a request to start; catalogue and execution validate the result separately. */
export function normalizedReservation(raw: unknown, current: string): Row {
  const reservation = object(raw)
  const evidence = literalEvidence(reservation.evidence, current)
  const valid = reservation.confidence === 'high' && !!evidence && reservationKinds.has(text(reservation.kind)) && reservation.kind !== 'none'
  return valid ? { kind: text(reservation.kind), evidence, confidence: 'high',
    unit_numbers: Array.isArray(reservation.unit_numbers)
      ? [...new Set(reservation.unit_numbers.map(text).filter(code => /^(?:LC-?)?\d{1,4}$/i.test(code)))].slice(0, 12) : [],
  } : { kind: 'none', evidence: null, unit_numbers: [], confidence: 'low' }
}

/**
 * Compatibility classifier for replies already sent before question memory was
 * introduced. New turns persist the returned id explicitly in the summary.
 */
export function pendingQuestionFromReply(reply: string): Row {
  const question = replyQuestions(reply).at(-1) || ''
  if (!question) return {}
  const value = normalized(question)
  let id: PendingQuestionId | null = null
  let act: string | undefined
  const asksName = /\b(?:su nombre|tu nombre|como (?:se llama|te llamas)|con (?:que|cual) nombre|con quien (?:tenemos|tengo) el gusto)\b/.test(value)
  const asksResidence = /\bresid(?:e|es|en|ir)\b|\b(?:su|tu|lugar de) residencia\b|\bresidencia (?:actual|habitual)\b|\b(?:donde|en que (?:ciudad|pais|lugar)).*\bviv(?:e|es|en|ir)\b/.test(value)
  const unitReferent = /\b(?:unidades?|departamentos?|suites?|penthouses?|local(?:es)?)\s*(?:numero\s*)?(?:lc[- ]?)?\d{1,4}\b(?!\s*(?:dormitorios?|habitaciones?|cuartos?|banos?|metros?|m2))/.test(normalized(reply))
  if (asksName || asksResidence) id = asksName && asksResidence ? 'lead_profile' : asksName ? 'lead_profile_name' : 'lead_profile_residence'
  else if (/visita|cita|recibirle|visitarnos|conocer el proyecto/.test(value)
    && /que dia|cual dia|fecha|que hora|horario|cuando/.test(value)) id = 'visit_date_time'
  else if (/visita|cita|visitarnos|conocer el proyecto|conocerlo en persona/.test(value)
    && /gustaria|desea|quiere|coordin|agend|animaria/.test(value)) id = 'visit_invitation'
  else if (/presupuesto total|monto disponible|capital inicial|entrada/.test(value)) id = 'budget_kind'
  else if (/presupuesto|cuanto.*(?:invertir|dispone|cuenta)|capital aproximado/.test(value)) id = 'budget_amount'
  else if (/vivir.*invertir|invertir.*vivir|residencia.*inversion|inversion.*residencia/.test(value)) id = 'property_purpose'
  else if (/que tipo de espacio|suite.*departamento|departamento.*suite|departamento.*penthouse|penthouse.*departamento|vivienda.*local|local.*vivienda/.test(value)) id = 'property_category'
  else if (/que planta|cual.*planta|que piso|cual.*piso/.test(value)) id = 'property_floor'
  else if (/cuantos? (?:dormitorios?|habitaciones?|cuartos?)/.test(value)) id = 'property_bedrooms'
  else if (/dormitorios?|habitaciones?|cuartos?/.test(value) && /revis|explor|evalu|acept|consider|servir/.test(value)) {
    id = 'property_bedrooms'; act = 'explore_alternatives'
  }
  else if (/que (?:area|superficie|tamano)|cuantos metros/.test(value)) id = 'property_area'
  else if (unitReferent && /cual.*(?:revisar|explorar|conocer|prefiere|interesa)|que opcion|(?:desea|gustaria|quiere).*(?:detalles|distribucion|conocer)/.test(value)) {
    id = 'unit_choice'
    if (/(?:desea|gustaria|quiere).*(?:detalles|distribucion|conocer)/.test(value)) act = 'show_unit_details'
  }
  else if (/cuando.*decision|plazo.*compra/.test(value)) id = 'purchase_timing'
  return id ? normalizedPendingQuestion({ id, question, ...(act ? { act } : {}) }) : {}
}

export function normalizeTurnSemantics(raw: unknown, current: string, pendingRaw: unknown): Row {
  const data = object(object(raw).turn_semantics)
  const pending = normalizedPendingQuestion(pendingRaw)
  const pendingId = questionIds.includes(text(pending.id) as PendingQuestionId) ? text(pending.id) : ''
  const primaryEvidence = literalEvidence(data.primary_evidence, current)
  const extractedPrimaryIntent = data.confidence === 'high' && primaryEvidence && primaryIntents.has(text(data.primary_intent))
    ? text(data.primary_intent) : 'other'
  const reservation = normalizedReservation(data.reservation, current)
  const reservationIntent = reservation.kind === 'request' ? 'request_reservation' : reservation.kind === 'information' ? 'ask_reservation' : null
  const primaryIntent = reservationIntent || (['request_reservation', 'ask_reservation'].includes(extractedPrimaryIntent) ? 'other' : extractedPrimaryIntent)
  const decisions: Row[] = []
  if (reservationIntent && reservationIntent !== extractedPrimaryIntent) decisions.push({ code: 'current_reservation_takes_priority',
    extractor_intent: extractedPrimaryIntent, canonical_intent: reservationIntent, source: 'reservation', evidence: reservation.evidence })
  if (!reservationIntent && ['request_reservation', 'ask_reservation'].includes(extractedPrimaryIntent)) decisions.push({ code: 'reservation_intent_without_current_action_evidence',
    extractor_intent: extractedPrimaryIntent, canonical_intent: primaryIntent, source: 'reservation' })

  const answer = object(data.answer_to_previous)
  const answerEvidence = literalEvidence(answer.evidence, current)
  let answerQuestionId = answer.confidence === 'high' && answerEvidence && pendingId
    && text(answer.question_id) === pendingId && answerKinds.has(text(answer.kind)) && answer.kind !== 'none'
    ? pendingId : ''

  const budget = object(data.budget)
  const budgetEvidence = literalEvidence(budget.evidence, current)
  const budgetStatus = budget.confidence === 'high' && budgetEvidence && budgetStatuses.has(text(budget.status))
    && budget.status !== 'not_discussed' ? text(budget.status) : 'not_discussed'
  const amount = budgetAmountWithLiteralQuantity(budget.amount, budgetEvidence)
  const property = object(data.property)
  const propertyEvidence = literalEvidence(property.evidence, current)
  const propertyConfident = property.confidence === 'high' && !!propertyEvidence
  const excluded = propertyConfident && Array.isArray(property.excluded_categories)
    ? [...new Set(property.excluded_categories.map(text).filter(value => propertyCategories.has(value)))] : []
  let category = propertyConfident && propertyCategories.has(text(property.category)) && !excluded.includes(text(property.category))
    ? text(property.category) : null
  const value = normalized(current)
  const normalizationIssues: string[] = []
  const housingQuantities = normalizedHousingQuantities(data.housing_quantities, current)
  const hasQuantityContract = Object.hasOwn(data, 'housing_quantities')
  const mentionedCategories = [...propertyCategories].filter(candidate => new RegExp(candidate === 'departamento'
    ? '\\b(?:departamentos?|departametnos?|departametos?|apartamentos?)\\b' : `\\b${candidate}s?\\b`).test(value))
  if (!propertyConfident && mentionedCategories.length === 1 && !/\b(?:no quiero|no prefiero|no me interesa|descarto)\b/.test(value)) category = mentionedCategories[0]
  const genericResidential = /\bviviendas?|residencial|(?:algo|opciones?|espacio) para vivir\b/.test(value)
    && !/\bsuites?|depart\w*ment\w*|apartamentos?|penthouses?|locales?\b/.test(value)
  if (genericResidential && category) { category = null; normalizationIssues.push('generic_residential_is_not_category') }
  let group = genericResidential ? 'residential' : category === 'local' ? 'commercial'
    : category ? 'residential' : propertyConfident && ['residential', 'commercial'].includes(text(property.group)) ? text(property.group) : null
  const lexicalFilters = propertyFiltersFromText(current, pendingId)
  const semanticFilters = propertyConfident ? normalizedPropertyFilters(property.filters) : emptyPropertyFilters()
  const structuredCatalog = normalizeCatalogRequest(object(raw).catalog_request, current)
  const bedroomRequirements = Array.isArray(structuredCatalog?.requirements) ? structuredCatalog.requirements.map(object)
    .filter(requirement => requirement.field === 'bedrooms' && requirement.strength === 'required') : []
  const bedroomRequirement = bedroomRequirements.length === 1 ? bedroomRequirements[0] : null
  const filterEvidence = Object.fromEntries(Object.keys(object(property.filter_evidence))
    .map(key => [key, propertyConfident ? literalEvidence(object(property.filter_evidence)[key], current) : '']))
  if (semanticFilters.bedrooms_required === true && !filterEvidence.bedrooms_required) {
    const sharedEvidence = sharedBedroomRigidityEvidence(bedroomRequirement, housingQuantities, current)
    if (sharedEvidence) filterEvidence.bedrooms_required = sharedEvidence
  }
  // Legacy extractions have no per-field evidence. New extractions cannot turn
  // historical attributes into current constraints merely by repeating them.
  if (property.filter_evidence !== undefined) {
    for (const key of Object.keys(semanticFilters) as (keyof PropertyFilters)[]) {
      if (semanticFilters[key] != null && !filterEvidence[key]) {
        delete semanticFilters[key]
        normalizationIssues.push(`property_filter_without_current_evidence:${key}`)
      }
    }
    Object.assign(semanticFilters, normalizedPropertyFilters(semanticFilters))
  }
  const preferenceChange = propertyPreferenceChange(current, {})
  if (preferenceChange.fewer_bedrooms === true && lexicalFilters.bedrooms === null) {
    semanticFilters.bedrooms = null; semanticFilters.bedrooms_required = false; delete semanticFilters.bedrooms_any
    if (category && !mentionedCategories.includes(category)) { category = null; normalizationIssues.push('fewer_bedrooms_does_not_choose_category') }
  }
  if (semanticFilters.bedrooms_required === true && lexicalFilters.bedrooms_required !== true && !filterEvidence.bedrooms_required) {
    semanticFilters.bedrooms_required = null
    normalizationIssues.push('bedrooms_requirement_without_explicit_evidence')
  }
  const filters: PropertyFilters = { ...semanticFilters }
  // These are two representations of the same current constraint. A validated
  // catalogue condition supplies its own evidence; an omitted duplicate quote
  // must not change "at least two" into "exactly two" in durable filters.
  // Multiple conditions and strict gt/lt remain in the catalogue contract.
  if (propertyConfident && bedroomRequirement && ['eq', 'gte', 'lte', 'between'].includes(text(bedroomRequirement.operator))
    && Number.isInteger(bedroomRequirement.value) && Number(bedroomRequirement.value) >= 1 && Number(bedroomRequirement.value) <= 30
    && (bedroomRequirement.operator !== 'between' || Number.isInteger(bedroomRequirement.upper_value)
      && Number(bedroomRequirement.upper_value) >= Number(bedroomRequirement.value) && Number(bedroomRequirement.upper_value) <= 30)) {
    const before = JSON.stringify(filters)
    filters.bedrooms = Number(bedroomRequirement.value)
    delete filters.bedrooms_any; delete filters.bedrooms_operator; delete filters.bedrooms_upper
    if (bedroomRequirement.operator !== 'eq') filters.bedrooms_operator = bedroomRequirement.operator as 'gte' | 'lte' | 'between'
    if (bedroomRequirement.operator === 'between') filters.bedrooms_upper = Number(bedroomRequirement.upper_value)
    filterEvidence.bedrooms = text(bedroomRequirement.evidence)
    filterEvidence.bedrooms_operator = text(bedroomRequirement.evidence)
    if (bedroomRequirement.operator === 'between') filterEvidence.bedrooms_upper = text(bedroomRequirement.evidence)
    if (before !== JSON.stringify(filters)) normalizationIssues.push('catalog_requirement_supplies_bedroom_relation')
  }
  for (const [key, lexicalValue] of Object.entries(lexicalFilters)) {
    if (structuredCatalog) continue
    if (lexicalValue === null) continue
    const field = key as keyof PropertyFilters, semanticValue = semanticFilters[field]
    const groundedSemanticValue = propertyConfident && !!filterEvidence[field] && semanticValue != null
    if (groundedSemanticValue) {
      if (JSON.stringify(semanticValue) !== JSON.stringify(lexicalValue)) normalizationIssues.push(`extractor_filter_precedes_keywords:${field}`)
    } else Object.assign(filters, { [field]: lexicalValue })
  }
  if (filters.bedrooms !== null && !semanticFilters.bedrooms_any?.includes(filters.bedrooms)) delete filters.bedrooms_any
  else if (filters.bedrooms_any?.length) filters.bedrooms = null
  // A syntactically valid integer is insufficient: the same number may refer
  // to people or evaluate existing options. Do not let the lexical fallback
  // recreate a filter that the typed current interpretation does not support.
  if (hasQuantityContract) {
    const groundedFilters = propertyFiltersWithQuantityMeaning(filters, { housing_quantities: housingQuantities })
    if (groundedFilters.bedrooms !== filters.bedrooms || JSON.stringify(groundedFilters.bedrooms_any) !== JSON.stringify(filters.bedrooms_any)) {
      filters.bedrooms = null; delete filters.bedrooms_any; filters.bedrooms_required = null
      filterEvidence.bedrooms = ''; filterEvidence.bedrooms_any = ''; filterEvidence.bedrooms_required = ''
      normalizationIssues.push('bedroom_filter_without_bedroom_requirement')
    }
  }
  // A bedroom answer is not a category choice. Keep a genuinely mentioned
  // category; older confirmed preferences are inherited by property-context.
  const bedroomRequest = filters.bedrooms != null || !!filters.bedrooms_any?.length
    || Array.isArray(structuredCatalog?.requirements) && structuredCatalog.requirements.some(r => object(r).field === 'bedrooms')
  if (bedroomRequest && category && !mentionedCategories.includes(category)
    && !['explicit', 'relative', 'comparison'].includes(text(property.reference_kind))) {
    category = null
    group = 'residential'
    normalizationIssues.push('bedroom_requirement_does_not_choose_category')
  }
  // The interpreter has already identified bedrooms, not commercial rooms or
  // household size. Apply that typed meaning without scanning the message.
  if (propertyConfident && !category && group !== 'residential' && (filters.bedrooms != null || filters.bedrooms_any?.length
    || Array.isArray(structuredCatalog?.requirements) && structuredCatalog.requirements.some(r => object(r).field === 'bedrooms'))
    && housingQuantities.some(q => q.dimension === 'bedrooms' && q.role === 'requirement')) {
    group = 'residential'
    normalizationIssues.push('bedroom_requirement_establishes_residential_search')
  }
  const hasFilters = Object.values(filters).some(value => value !== null)
  if (hasFilters && pendingId.startsWith('budget') && /habit|dormitor|cuarto|planta|piso|opciones/.test(value)) {
    answerQuestionId = ''; normalizationIssues.push('property_query_is_not_budget_answer')
  }
  const selector = propertyConfident && unitSelectors.has(text(property.selector)) ? text(property.selector) : null
  const asksRanking = /\b(?:cual|cuales|que|cuanto)\b.*\b(?:mas grande|mas amplio|mayor|mas pequen|mas barat|mas economic|menor)/.test(value)
  const asksDetails = /\b(?:detalles|distribucion|que (?:tiene|incluye|ofrece))\b/.test(value)
  let operation = propertyConfident && operations.has(text(property.operation)) ? text(property.operation) : 'none'
  const explicitOperation = propertyConfident && operations.has(text(property.operation)) && property.operation !== 'none'
  if (explicitOperation) {
    if (asksRanking && operation !== 'rank') normalizationIssues.push('extractor_operation_precedes_ranking_keywords')
  } else if (asksRanking) operation = 'rank'
  else if (hasFilters || genericResidential) operation = 'search'
  else if (propertyConfident) {
    if (property.reference_kind === 'comparison') operation = 'compare'
    else if (asksDetails) operation = 'details'
    else if (category && property.reference_kind !== 'relative' && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length)) operation = 'search'
    else if (primaryIntent === 'select_property' || property.reference_kind === 'relative') operation = 'select'
  }
  if (operation === 'select' && category && !['relative', 'followup'].includes(text(property.reference_kind))
    && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length)) {
    operation = 'search'; normalizationIssues.push('category_choice_refines_search')
  }
  if (genericResidential && operation === 'select' && !selector && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length)) {
    operation = 'search'; normalizationIssues.push('generic_group_does_not_select_unit')
  }
  if (operation === 'select' && hasFilters && !selector && !['explicit', 'relative', 'comparison'].includes(text(property.reference_kind))
    && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length)) {
    operation = 'search'; normalizationIssues.push('property_filter_does_not_select_unit')
  }
  const queryScope = propertyConfident && queryScopes.has(text(property.query_scope)) ? text(property.query_scope)
    : operation === 'rank' && /\b(?:de es[at]as|entre es[at]as|de las (?:que|opciones))\b/.test(value) ? 'offered'
      : operation === 'rank' || operation === 'search' ? 'catalog' : null

  return {
    primary_intent: primaryIntent,
    primary_evidence: primaryIntent === 'other' ? null : reservationIntent ? reservation.evidence : primaryEvidence,
    confidence: primaryIntent === 'other' ? 'low' : 'high',
    reservation,
    ...(hasQuantityContract ? { housing_quantities: housingQuantities, household: householdFromQuantities(housingQuantities) } : {}),
    interpretation: { extractor_primary_intent: extractedPrimaryIntent, canonical_primary_intent: primaryIntent, decisions },
    property: {
      group, category, excluded_categories: excluded, operation, filters, query_scope: queryScope,
      ...(property.filter_evidence !== undefined ? { filter_evidence: filterEvidence } : {}),
      reference_kind: propertyConfident && referenceKinds.has(text(property.reference_kind)) ? text(property.reference_kind) : 'none',
      unit_numbers: propertyConfident && Array.isArray(property.unit_numbers)
        ? [...new Set(property.unit_numbers.map(text).filter(value => /^(?:LC-?)?\d{1,4}$/i.test(value)))].slice(0, 12) : [],
      selector,
      evidence: propertyConfident ? propertyEvidence : null, confidence: propertyConfident ? 'high' : 'low',
    },
    answer_to_previous: answerQuestionId ? {
      question_id: answerQuestionId,
      kind: text(answer.kind),
      evidence: answerEvidence,
      confidence: 'high',
    } : { question_id: null, kind: 'none', evidence: null, confidence: 'low' },
    budget: budgetStatus === 'not_discussed' ? {
      status: 'not_discussed', amount: null, evidence: null, confidence: 'low',
    } : { status: budgetStatus, amount, evidence: budgetEvidence, confidence: 'high' },
    normalization_issues: normalizationIssues,
  }
}

export function answersPendingQuestion(semantics: unknown, questionId: PendingQuestionId, kind?: string) {
  const answer = object(object(semantics).answer_to_previous)
  return answer.confidence === 'high' && answer.question_id === questionId && (!kind || answer.kind === kind)
}

export function semanticBudgetStatus(semantics: unknown) {
  const budget = object(object(semantics).budget)
  return budget.confidence === 'high' && budgetStatuses.has(text(budget.status)) ? text(budget.status) : 'not_discussed'
}
