import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'

export const questionIds = [
  'visit_invitation',
  'visit_date_time',
  'budget_amount',
  'budget_kind',
  'property_category',
  'property_floor',
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

export const TURN_SEMANTIC_EXTRACTION_RULES = `
Devuelva SIEMPRE un objeto "turn_semantics" con esta forma:
{
  "primary_intent":"request_visit|answer_previous|select_property|ask_price|discuss_budget|ask_financing|project_information|other",
  "primary_evidence":"copia literal breve del mensaje actual",
  "confidence":"high|medium|low",
  "answer_to_previous":{
    "question_id":"visit_invitation|visit_date_time|budget_amount|budget_kind|property_category|property_floor|unit_choice|purchase_timing|none",
    "kind":"affirmative|negative|uncertain|value|none",
    "evidence":"copia literal breve del mensaje actual o cadena vacía",
    "confidence":"high|medium|low"
  },
  "property":{
    "category":null,
    "excluded_categories":[],
    "reference_kind":"none|explicit|relative|comparison|followup",
    "unit_numbers":[],
    "selector":null,
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
answer_to_previous solo puede usar el question_id exacto recibido en pregunta_pendiente. Si no responde esa pregunta, use question_id=none y kind=none.
Una aceptación de una invitación a visita, incluso "sí está bien", es affirmative de visit_invitation. Una fecha u hora dada como respuesta es value de visit_date_time.
En budget, unknown incluye dudas sobre cuánto puede gastar aunque haya errores ortográficos. sufficient_for_selected_unit significa que el cliente afirma que el precio de la unidad elegida sí se ajusta a su presupuesto; insufficient_for_selected_unit significa que afirma lo contrario. No convierta una simple aceptación, una cifra del precio citada por el bot ni una duda en una declaración de capacidad de pago.
amount se completa solo con una cifra expresada por el cliente en el mensaje actual. No copie cifras del historial.
property.category solo indica una preferencia AFIRMADA AHORA: suite|departamento|penthouse|local, no la última categoría mencionada ni una inferencia del historial. En "me interesan más los departamentos porque los penthouse deben ser muy caros", category=departamento y excluded_categories=[penthouse]. Mencionar una opción para descartarla no es elegirla. Una preocupación por precios no declara un presupuesto.
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
  else if (/cual.*(?:revisar|explorar|conocer|prefiere|interesa)|que opcion/.test(value)) id = 'unit_choice'
  else if (/cuando.*decision|plazo.*compra/.test(value)) id = 'purchase_timing'
  return id ? { id, question: question.slice(0, 500) } : {}
}

export function normalizeTurnSemantics(raw: unknown, current: string, pendingRaw: unknown): Row {
  const data = object(object(raw).turn_semantics)
  const pending = object(pendingRaw)
  const pendingId = questionIds.includes(text(pending.id) as PendingQuestionId) ? text(pending.id) : ''
  const primaryEvidence = literalEvidence(data.primary_evidence, current)
  const primaryIntent = data.confidence === 'high' && primaryEvidence && primaryIntents.has(text(data.primary_intent))
    ? text(data.primary_intent) : 'other'

  const answer = object(data.answer_to_previous)
  const answerEvidence = literalEvidence(answer.evidence, current)
  const answerQuestionId = answer.confidence === 'high' && answerEvidence && pendingId
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
  const category = propertyConfident && propertyCategories.has(text(property.category)) && !excluded.includes(text(property.category))
    ? text(property.category) : null

  return {
    primary_intent: primaryIntent,
    primary_evidence: primaryIntent === 'other' ? null : primaryEvidence,
    confidence: primaryIntent === 'other' ? 'low' : 'high',
    property: {
      category, excluded_categories: excluded,
      reference_kind: propertyConfident && referenceKinds.has(text(property.reference_kind)) ? text(property.reference_kind) : 'none',
      unit_numbers: propertyConfident && Array.isArray(property.unit_numbers)
        ? [...new Set(property.unit_numbers.map(text).filter(value => /^(?:LC-?)?\d{1,4}$/i.test(value)))].slice(0, 12) : [],
      selector: propertyConfident && unitSelectors.has(text(property.selector)) ? text(property.selector) : null,
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
