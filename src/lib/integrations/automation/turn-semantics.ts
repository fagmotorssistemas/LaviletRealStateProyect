import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'

export const questionIds = [
  'visit_invitation',
  'visit_date_time',
  'budget_amount',
  'budget_kind',
  'property_category',
  'property_floor',
  'property_bedrooms',
  'property_area',
  'unit_choice',
  'purchase_timing',
] as const

export type PendingQuestionId = typeof questionIds[number]

const primaryIntents = new Set([
  'request_visit', 'answer_previous', 'select_property', 'ask_price', 'discuss_budget',
  'ask_financing', 'project_information', 'other',
])
const answerKinds = new Set(['affirmative', 'negative', 'uncertain', 'value', 'none'])
const budgetStatuses = new Set([
  'not_discussed', 'unknown', 'amount', 'maximum_total', 'initial_capital',
  'sufficient_for_selected_unit', 'insufficient_for_selected_unit', 'declines_to_disclose',
])
const propertyCategories = new Set(['suite', 'departamento', 'penthouse', 'local'])
const referenceKinds = new Set(['none', 'explicit', 'relative', 'comparison', 'followup'])
const unitSelectors = new Set(['largest', 'smallest', 'cheapest', 'most_expensive', 'first', 'last'])
const operations = new Set(['search', 'rank', 'compare', 'select', 'details', 'none'])
const queryScopes = new Set(['catalog', 'offered', 'comparison', 'selected'])
const questionActs = new Set(['choose_unit', 'confirm_unit', 'show_unit_details', 'choose_category', 'choose_floor', 'explore_alternatives', 'budget', 'visit', 'other'])

export type PropertyFilters = { floor_number: number | null; bedrooms: number | null; bedrooms_required: boolean | null; min_area_m2: number | null; max_area_m2: number | null }
export const emptyPropertyFilters = (): PropertyFilters => ({ floor_number: null, bedrooms: null, bedrooms_required: null, min_area_m2: null, max_area_m2: null })
const enumSchema = (values: Iterable<string>) => ({ type: 'string', enum: [...values] })
const nullableEnumSchema = (values: Iterable<string>) => ({ type: ['string', 'null'], enum: [...values, null] })
const strictObject = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const confidenceSchema = enumSchema(['high', 'medium', 'low'])

/** The complete strict schema for the turn_semantics property of an extraction. */
export const TURN_SEMANTICS_SCHEMA = strictObject({
  primary_intent: enumSchema(primaryIntents), primary_evidence: { type: 'string' }, confidence: confidenceSchema,
  answer_to_previous: strictObject({ question_id: enumSchema([...questionIds, 'none']), kind: enumSchema(answerKinds), evidence: { type: 'string' }, confidence: confidenceSchema }),
  property: strictObject({
    group: nullableEnumSchema(['residential', 'commercial']), category: nullableEnumSchema(propertyCategories),
    excluded_categories: { type: 'array', items: enumSchema(propertyCategories) }, operation: enumSchema(operations),
    reference_kind: enumSchema(referenceKinds), unit_numbers: { type: 'array', items: { type: 'string' } },
    selector: nullableEnumSchema(unitSelectors), query_scope: nullableEnumSchema(queryScopes),
    filters: strictObject({ floor_number: { type: ['integer', 'null'] }, bedrooms: { type: ['integer', 'null'] }, bedrooms_required: { type: ['boolean', 'null'] }, min_area_m2: { type: ['number', 'null'] }, max_area_m2: { type: ['number', 'null'] } }),
    evidence: { type: 'string' }, confidence: confidenceSchema,
  }),
  budget: strictObject({ status: enumSchema(budgetStatuses), amount: { type: ['number', 'null'] }, evidence: { type: 'string' }, confidence: confidenceSchema }),
})

export function normalizedPropertyFilters(raw: unknown): PropertyFilters {
  const row = object(raw)
  const bounded = (key: string, max: number, integer = false, minimum = 0) => typeof row[key] === 'number' && Number.isFinite(row[key])
    && Number(row[key]) >= minimum && Number(row[key]) <= max && (!integer || Number.isInteger(row[key])) ? Number(row[key]) : null
  return { floor_number: bounded('floor_number', 100, true), bedrooms: bounded('bedrooms', 30, true), bedrooms_required: typeof row.bedrooms_required === 'boolean' ? row.bedrooms_required : null,
    min_area_m2: bounded('min_area_m2', 100000, false, 1), max_area_m2: bounded('max_area_m2', 100000, false, 1) }
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
    operation: operations.has(text(row.operation)) ? text(row.operation) : 'search',
    selector: unitSelectors.has(text(row.selector)) ? text(row.selector) : null,
    scope: queryScopes.has(text(row.scope || row.query_scope)) ? text(row.scope || row.query_scope) : 'catalog',
  }
}

const numberWords: Record<string, number> = { cero: 0, un: 1, una: 1, uno: 1, primera: 1, primer: 1, dos: 2, segunda: 2, segundo: 2, tres: 3, tercera: 3, tercer: 3, cuatro: 4, cuarta: 4, cuarto: 4, cinco: 5, quinta: 5, quinto: 5, seis: 6, sexta: 6, sexto: 6, siete: 7, septima: 7, septimo: 7, ocho: 8, octava: 8, octavo: 8, nueve: 9, novena: 9, noveno: 9, diez: 10, decima: 10, decimo: 10 }
const numberToken = '(?:\\d{1,2}(?:ta|to|ra|ro|da|do|ma|mo|va|vo)?|' + Object.keys(numberWords).join('|') + ')'
const tokenNumber = (value: string) => numberWords[value] ?? Number.parseInt(value, 10)

/** Conservative spelling compatibility; model values still carry the original evidence. */
export function propertyFiltersFromText(current: string, pendingId = ''): PropertyFilters {
  const value = normalized(current).replace(/(?<![a-z])(?:habiataciones|habitacones|abitaciones)\b/g, 'habitaciones')
  const filters = emptyPropertyFilters()
  const floor = value.match(new RegExp('\\b(?:planta|piso|nivel)\\s*(?:numero\\s*)?(' + numberToken + ')\\b'))
    || value.match(new RegExp('\\b(' + numberToken + ')\\s*(?:planta|piso|nivel)\\b'))
    || (pendingId === 'property_floor' ? value.match(new RegExp('^(?:la |el )?(' + numberToken + ')$')) : null)
  if (floor) filters.floor_number = tokenNumber(floor[1])
  if (/\bplanta baja\b/.test(value)) filters.floor_number = 0
  const bedrooms = value.match(new RegExp('(?:^|[^a-z0-9])(?:de\\s*)?(' + numberToken + ')\\s*(?:dormitorios?|habitaciones?|cuartos?)\\b'))
  if (bedrooms) filters.bedrooms = tokenNumber(bedrooms[1])
  if (bedrooms && !/\bno (?:es|son|necesito|necesariamente|tienen que ser)\b/.test(value)
    && (/\b(?:exactamente|indispensables?|obligatori[oa]s?|necesariamente)\b/.test(value)
      || /\b(?:menos|otra cantidad)\b.{0,25}\bno me sirve\b|\bno (?:acepto|quiero) menos\b/.test(value))) filters.bedrooms_required = true
  const area = value.match(/\b(al menos|minimo|desde|hasta|maximo|menos de|mas de)\s*(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metros)/)
  if (area) filters[/hasta|maximo|menos de/.test(area[1]) ? 'max_area_m2' : 'min_area_m2'] = Number(area[2].replace(',', '.'))
  return normalizedPropertyFilters(filters)
}

export function normalizedPendingQuestion(raw: unknown, catalog?: Row[]): Row {
  const row = object(raw), id = text(row.id)
  if (!questionIds.includes(id as PendingQuestionId)) return {}
  const validIds = catalog ? new Set(catalog.map(unit => text(unit.id))) : null
  const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(text).filter(id => id && (!validIds || validIds.has(id))))] : []
  const proposedQuery = row.act === 'explore_alternatives' ? normalizedPropertyQuery(row.proposed_query) : {}
  return { id, act: questionActs.has(text(row.act)) ? text(row.act) : id === 'unit_choice' ? 'choose_unit' : id === 'property_floor' ? 'choose_floor'
    : id === 'property_category' ? 'choose_category' : id.startsWith('budget') ? 'budget' : id.startsWith('visit') ? 'visit' : 'other',
  question: text(row.question).trim().slice(0, 500), target_ids: ids(row.target_ids), candidate_ids: ids(row.candidate_ids),
  ...(Object.keys(proposedQuery).length ? { proposed_query: { ...proposedQuery, operation: 'search', selector: null } } : {}) }
}

export const TURN_SEMANTIC_EXTRACTION_RULES = `
Devuelva SIEMPRE un objeto "turn_semantics" con esta forma:
{
  "primary_intent":"request_visit|answer_previous|select_property|ask_price|discuss_budget|ask_financing|project_information|other",
  "primary_evidence":"copia literal breve del mensaje actual",
  "confidence":"high|medium|low",
  "answer_to_previous":{
    "question_id":"visit_invitation|visit_date_time|budget_amount|budget_kind|property_category|property_floor|property_bedrooms|property_area|unit_choice|purchase_timing|none",
    "kind":"affirmative|negative|uncertain|value|none",
    "evidence":"copia literal breve del mensaje actual o cadena vacía",
    "confidence":"high|medium|low"
  },
  "property":{
    "group":null,
    "category":null,
    "excluded_categories":[],
    "operation":"search|rank|compare|select|details|none",
    "reference_kind":"none|explicit|relative|comparison|followup",
    "unit_numbers":[],
    "selector":null,
    "query_scope":null,
    "filters":{"floor_number":null,"bedrooms":null,"bedrooms_required":null,"min_area_m2":null,"max_area_m2":null},
    "evidence":"copia literal breve del mensaje actual o cadena vacía",
    "confidence":"high|medium|low"
  },
  "budget":{
    "status":"not_discussed|unknown|amount|maximum_total|initial_capital|sufficient_for_selected_unit|insufficient_for_selected_unit|declines_to_disclose",
    "amount":null,
    "evidence":"copia literal breve del mensaje actual o cadena vacía",
    "confidence":"high|medium|low"
  }
}.
Interprete el mensaje actual junto con historial_reciente y pregunta_pendiente. El historial aclara referencias como "sí", "esa", "ese precio" o "no estoy seguro", pero la evidencia siempre debe copiar palabras del mensaje ACTUAL.
Resuelva primero sobre QUÉ pide información. Una solicitud general tras solo saludos es primary_intent=project_information y property.operation=none, aunque tenga errores de escritura. Con una unidad o alternativas activas, «quiero información», «sí, envíeme detalles» o «¿y los precios?» continúan ese referente: use details, followup y el alcance correspondiente; no reinicie la presentación ni busque todo el catálogo. Una petición explícita de información general del proyecto cambia el tema. Si hay varias solicitudes, conserve todas; si el referente es ambiguo, no invente una unidad. Aceptar explorar alternativas no elimina la necesidad original, pero la búsqueda activa debe seguir las alternativas propuestas, no repetir el filtro sin resultados.
answer_to_previous solo puede usar el question_id exacto recibido en pregunta_pendiente. Si no responde esa pregunta, use question_id=none y kind=none.
Una aceptación de una invitación a visita, incluso "sí está bien", es affirmative de visit_invitation. Una fecha u hora dada como respuesta es value de visit_date_time.
En budget, unknown incluye dudas sobre cuánto puede gastar aunque haya errores ortográficos. sufficient_for_selected_unit significa que el cliente afirma que el precio de la unidad elegida sí se ajusta a su presupuesto; insufficient_for_selected_unit significa que afirma lo contrario. No convierta una simple aceptación, una cifra del precio citada por el bot ni una duda en una declaración de capacidad de pago.
amount se completa solo con una cifra expresada por el cliente en el mensaje actual. No copie cifras del historial.
property.category solo indica una preferencia AFIRMADA AHORA: suite|departamento|penthouse|local, no la última categoría mencionada ni una inferencia del historial. En "me interesan más los departamentos porque los penthouse deben ser muy caros", category=departamento y excluded_categories=[penthouse]. Mencionar una opción para descartarla no es elegirla. Una preocupación por precios no declara un presupuesto.
property.group distingue residential (vivienda en general) de commercial (locales). «Me interesa vivienda» y «algo para vivir» son group=residential, category=null: no implican elegir departamento ni excluir suites. Solo complete category si el mensaje realmente elige o consulta esa categoría concreta.
property.operation distingue buscar opciones (search), preguntar cuáles son mayores/menores/baratas (rank), comparar (compare), elegir afirmativamente (select) y pedir detalles (details). «¿Cuál es la opción más grande?» es rank, NO select. «Prefiero la más grande de esas» es select. Un empate se puede mostrar como resultado de una consulta; no obliga al cliente a elegir antes de recibir información.
property.filters expresa restricciones actuales: «5ta planta», «quinta planta» y «piso cinco» son floor_number=5; «de5habiataciones» expresa bedrooms=5. Corrija errores evidentes sin inventar datos. Una restricción no es un número de unidad ni una negativa a la pregunta anterior. «No tiene opciones de 5 habitaciones» pregunta disponibilidad, no rechaza presupuesto.
bedrooms_required=true solo si declara indispensable/exacta esa cantidad; false solo si acepta expresamente otra cantidad; null si no expresa esa decisión. No insista con menos dormitorios cuando el requisito es indispensable.
query_scope=catalog para buscar o consultar máximos sin lista concreta, offered para «de esas opciones», comparison para la comparación activa, selected para la elegida. Preserve null si no aplica. La memoria conserva filtros previos; no los extraiga otra vez como declaraciones nuevas.
pregunta_pendiente.act, target_ids y candidate_ids expresan el foco real. «Sí prefiero esa opción» tras ofrecer detalles del 502 acepta esa oferta sobre 502 aunque antes se mencionara 504; es referencia followup, no explicit. No convierta aceptar detalles o un recorrido en visita, compra o reserva.
Si pregunta_pendiente.act=explore_alternatives, una aceptación permite explorar proposed_query, no elige una unidad ni reemplaza el requisito original. El sistema aplicará esa consulta; no vuelva a extraer dormitorios del historial ni transforme el sí en select. Elegir una categoría (por ejemplo, departamentos entre alternativas residenciales) refina la búsqueda sin borrar dormitorios, planta o superficie ya establecidos. Un sí a una elección entre varias categorías o unidades no identifica una de ellas.
property.reference_kind: explicit si identifica una unidad; comparison si compara varias; relative para "el más grande", "la primera", "el más barato"; followup para continuar una consulta sobre unidades previas ("¿y en precio?"). En relative seleccione selector=largest|smallest|cheapest|most_expensive|first|last según corresponda. Use las opciones que el bot REALMENTE acaba de mostrar, no otra categoría guardada anteriormente. Un empate no permite elegir una unidad.
unit_numbers contiene solo códigos del catálogo realmente referidos. En explicit deben aparecer en el mensaje actual; en comparison/followup pueden proceder de la comparación activa del contexto. Nunca convierta precios, áreas, horas o pisos en números de unidad. En relative no invente un código: el sistema resuelve selector contra las opciones mostradas. Una pregunta "¿y en precio?" tras comparar 202 y 302 se refiere a AMBAS unidades, no a todo el catálogo.
Use confidence=high solo cuando la evidencia literal y el contexto produzcan una única interpretación. No invente intención, unidad, presupuesto ni aceptación.
`

function literalEvidence(value: unknown, current: string) {
  const evidence = text(value).trim()
  if (!evidence || evidence.length > 240) return ''
  return normalized(current).includes(normalized(evidence)) ? evidence : ''
}

function lastQuestion(reply: string) {
  const matches = reply.match(/[^?¿\n]*\?/g)
  return text(matches?.at(-1)).trim() || reply.trim()
}

/**
 * Compatibility classifier for replies already sent before question memory was
 * introduced. New turns persist the returned id explicitly in the summary.
 */
export function pendingQuestionFromReply(reply: string): Row {
  const question = lastQuestion(reply)
  const value = normalized(question)
  let id: PendingQuestionId | null = null
  if (/visita|cita|recibirle|visitarnos|conocer el proyecto/.test(value)
    && /que dia|cual dia|fecha|que hora|horario|cuando/.test(value)) id = 'visit_date_time'
  else if (/visita|cita|visitarnos|conocer el proyecto|conocerlo en persona/.test(value)
    && /gustaria|desea|quiere|coordin|agend|animaria/.test(value)) id = 'visit_invitation'
  else if (/presupuesto total|monto disponible|capital inicial|entrada/.test(value)) id = 'budget_kind'
  else if (/presupuesto|cuanto.*(?:invertir|dispone|cuenta)|capital aproximado/.test(value)) id = 'budget_amount'
  else if (/que tipo de espacio|suite.*departamento|departamento.*suite|departamento.*penthouse|penthouse.*departamento|locales comerciales/.test(value)) id = 'property_category'
  else if (/que planta|cual.*planta|que piso|cual.*piso/.test(value)) id = 'property_floor'
  else if (/cuantos? (?:dormitorios?|habitaciones?|cuartos?)/.test(value)) id = 'property_bedrooms'
  else if (/que (?:area|superficie|tamano)|cuantos metros/.test(value)) id = 'property_area'
  else if (/cual.*(?:revisar|explorar|conocer|prefiere|interesa)|que opcion|(?:desea|gustaria|quiere).*(?:detalles|distribucion|conocer esta opcion)/.test(value)) id = 'unit_choice'
  else if (/cuando.*decision|plazo.*compra/.test(value)) id = 'purchase_timing'
  return id ? normalizedPendingQuestion({ id, question, ...(id === 'unit_choice' && /(?:desea|gustaria|quiere).*(?:detalles|distribucion|conocer esta opcion)/.test(value) ? { act: 'show_unit_details' } : {}) }) : {}
}

export function normalizeTurnSemantics(raw: unknown, current: string, pendingRaw: unknown): Row {
  const data = object(object(raw).turn_semantics)
  const pending = normalizedPendingQuestion(pendingRaw)
  const pendingId = questionIds.includes(text(pending.id) as PendingQuestionId) ? text(pending.id) : ''
  const primaryEvidence = literalEvidence(data.primary_evidence, current)
  const primaryIntent = data.confidence === 'high' && primaryEvidence && primaryIntents.has(text(data.primary_intent))
    ? text(data.primary_intent) : 'other'

  const answer = object(data.answer_to_previous)
  const answerEvidence = literalEvidence(answer.evidence, current)
  let answerQuestionId = answer.confidence === 'high' && answerEvidence && pendingId
    && text(answer.question_id) === pendingId && answerKinds.has(text(answer.kind)) && answer.kind !== 'none'
    ? pendingId : ''

  const budget = object(data.budget)
  const budgetEvidence = literalEvidence(budget.evidence, current)
  const budgetStatus = budget.confidence === 'high' && budgetEvidence && budgetStatuses.has(text(budget.status))
    && budget.status !== 'not_discussed' ? text(budget.status) : 'not_discussed'
  const amount = typeof budget.amount === 'number' && Number.isFinite(budget.amount) && budget.amount > 0
    && /\d/.test(budgetEvidence) ? Number(budget.amount) : null
  const property = object(data.property)
  const propertyEvidence = literalEvidence(property.evidence, current)
  const propertyConfident = property.confidence === 'high' && !!propertyEvidence
  const excluded = propertyConfident && Array.isArray(property.excluded_categories)
    ? [...new Set(property.excluded_categories.map(text).filter(value => propertyCategories.has(value)))] : []
  let category = propertyConfident && propertyCategories.has(text(property.category)) && !excluded.includes(text(property.category))
    ? text(property.category) : null
  const value = normalized(current)
  const normalizationIssues: string[] = []
  const mentionedCategories = [...propertyCategories].filter(candidate => new RegExp(candidate === 'departamento'
    ? '\\b(?:departamentos?|departametnos?|departametos?|apartamentos?)\\b' : `\\b${candidate}s?\\b`).test(value))
  if (!propertyConfident && mentionedCategories.length === 1 && !/\b(?:no quiero|no prefiero|no me interesa|descarto)\b/.test(value)) category = mentionedCategories[0]
  const genericResidential = /\bviviendas?|residencial|(?:algo|opciones?|espacio) para vivir\b/.test(value)
    && !/\bsuites?|depart\w*ment\w*|apartamentos?|penthouses?|locales?\b/.test(value)
  if (genericResidential && category) { category = null; normalizationIssues.push('generic_residential_is_not_category') }
  const group = genericResidential ? 'residential' : category === 'local' ? 'commercial'
    : category ? 'residential' : propertyConfident && ['residential', 'commercial'].includes(text(property.group)) ? text(property.group) : null
  const lexicalFilters = propertyFiltersFromText(current, pendingId)
  const semanticFilters = propertyConfident ? normalizedPropertyFilters(property.filters) : emptyPropertyFilters()
  if (semanticFilters.bedrooms_required === true && lexicalFilters.bedrooms_required !== true) {
    semanticFilters.bedrooms_required = null
    normalizationIssues.push('bedrooms_requirement_without_explicit_evidence')
  }
  const filters = Object.fromEntries(Object.entries(lexicalFilters).map(([key, literal]) => [key, literal ?? semanticFilters[key as keyof PropertyFilters]])) as PropertyFilters
  const hasFilters = Object.values(filters).some(value => value !== null)
  if (hasFilters && pendingId.startsWith('budget') && /habit|dormitor|cuarto|planta|piso|opciones/.test(value)) {
    answerQuestionId = ''; normalizationIssues.push('property_query_is_not_budget_answer')
  }
  const selector = propertyConfident && unitSelectors.has(text(property.selector)) ? text(property.selector) : null
  const asksRanking = /\b(?:cual|cuales|que|cuanto)\b.*\b(?:mas grande|mas amplio|mayor|mas pequen|mas barat|mas economic|menor)/.test(value)
  const asksDetails = /\b(?:detalles|distribucion|que (?:tiene|incluye|ofrece))\b/.test(value)
  let operation = propertyConfident && operations.has(text(property.operation)) ? text(property.operation) : 'none'
  if (asksRanking) operation = 'rank'
  else if (hasFilters && !['compare', 'details'].includes(operation)) operation = 'search'
  else if (genericResidential) operation = 'search'
  else if (operation === 'none' && propertyConfident) {
    if (property.reference_kind === 'comparison') operation = 'compare'
    else if (asksDetails) operation = 'details'
    else if (category && property.reference_kind !== 'relative' && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length)) operation = 'search'
    else if (primaryIntent === 'select_property' || property.reference_kind === 'relative') operation = 'select'
  }
  if (operation === 'select' && category && !['relative', 'followup'].includes(text(property.reference_kind))
    && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length)) {
    operation = 'search'; normalizationIssues.push('category_choice_refines_search')
  }
  const queryScope = propertyConfident && queryScopes.has(text(property.query_scope)) ? text(property.query_scope)
    : operation === 'rank' && /\b(?:de es[at]as|entre es[at]as|de las (?:que|opciones))\b/.test(value) ? 'offered'
      : operation === 'rank' || operation === 'search' ? 'catalog' : null

  return {
    primary_intent: primaryIntent,
    primary_evidence: primaryIntent === 'other' ? null : primaryEvidence,
    confidence: primaryIntent === 'other' ? 'low' : 'high',
    property: {
      group, category, excluded_categories: excluded, operation, filters, query_scope: queryScope,
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
