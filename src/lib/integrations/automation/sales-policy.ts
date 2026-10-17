import { botVisitPolicy,visitInvitation } from '@/lib/inmobiliaria/botVisits'
import { COMMERCIAL_ENGAGEMENT_VERSION,commercialEngagement,passiveSalesRules,type CommercialEngagementTurn } from './commercial-engagement'
import { commercialJourneyPlan } from './commercial-journey'
import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { projectObjectionRequests } from './project-objections'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const literal = (current: string, evidence: unknown) => !!text(evidence).trim() && current.includes(text(evidence).trim())
const semanticsFor = (value: unknown) => {
  const row = object(value)
  return object(row.semantics || row.semantica_turno || row.turn_semantics || row)
}
const pendingFor = (value: unknown) => {
  const row = object(value)
  return object(row.pendingQuestion || row.pregunta_pendiente || object(row.intent || row.contrato_turno).pending_question)
}
const currentRequests = (value: unknown, current: string) => {
  const row = object(value), semantics = semanticsFor(row), intent = object(row.intent || row.contrato_turno)
  return rows(row.requests || row.solicitudes_interpretadas || intent.requests || semantics.requests)
    .filter(request => request.source !== 'pending' && acceptedExtractorConfidence(request.confidence) && literal(current, request.evidence))
}

export function acceptsUnitOptions(current: string, lastReply: string, turn: unknown = {}) {
  void lastReply
  const pending = pendingFor(turn), answer = object(semanticsFor(turn).answer_to_previous)
  return ['unit_choice', 'property_requirements', 'property_comparison'].includes(text(pending.id))
    && ['explore_quoted_options', 'explore_alternatives', 'compare_properties'].includes(text(pending.act))
    && answer.question_id === pending.id && answer.kind === 'affirmative'
    && acceptedExtractorConfidence(answer.confidence) && literal(current, answer.evidence)
}

export function acceptsVisitInvitation(current: string, lastReply: string, turn: unknown = {}) {
  void lastReply
  const pending = pendingFor(turn), semantics = semanticsFor(turn), answer = object(semantics.answer_to_previous)
  return pending.id === 'visit_invitation' && pending.act === 'visit'
    && answer.question_id === pending.id && answer.kind === 'affirmative'
    && acceptedExtractorConfidence(answer.confidence) && literal(current, answer.evidence)
}

export function ambiguousVisitAcceptance(current: string, lastReply: string, turn: unknown = {}) {
  void lastReply
  const pending = pendingFor(turn), answer = object(semanticsFor(turn).answer_to_previous)
  return pending.id === 'visit_invitation' && pending.act === 'visit'
    && answer.question_id === pending.id && answer.kind === 'uncertain'
    && acceptedExtractorConfidence(answer.confidence) && literal(current, answer.evidence)
}

/** Accepted writer receipts are durable facts. Old prose is never rescanned
 * for invitations, financial language or evidence of client preference. */
export function salesMemory(previous: unknown, history: unknown) {
  const saved = object(previous)
  let invited = saved.visit_invited === true, declined = saved.visit_declined === true
  let financingMentioned = saved.financing_mentioned === true, unitsOffered = saved.unit_options_offered === true
  for (const row of rows(history).filter(message => ['bot', 'asesor'].includes(text(message.role)))) {
    const audit = object(row.tool_calls), review = object(audit.turn_completeness)
    const receipt = object(review.writer_receipts || audit.writer_receipts)
    const pending = object(audit.pending_question)
    invited ||= receipt.visit_invited === true || pending.id === 'visit_invitation' && pending.act === 'visit'
    declined ||= receipt.visit_declined === true
    financingMentioned ||= receipt.financing_mentioned === true || receipt.offered_action === 'financing_review'
      || text(pending.id).startsWith('financing_') && pending.act === 'financing'
    unitsOffered ||= receipt.unit_options_offered === true || pending.id === 'unit_choice'
      || pending.id === 'property_requirements' && pending.act === 'explore_alternatives'
  }
  return { visit_invited: invited, visit_declined: declined, financing_mentioned: financingMentioned,
    unit_options_offered: unitsOffered, passive_sales: saved.passive_sales === true, property_interest: saved.property_interest === true }
}

export function mentionsFinancing(value: string, interpreted: unknown = {}) {
  const semantics = semanticsFor(interpreted)
  return currentRequests(interpreted, value).some(request => request.domain === 'financing')
    || semantics.primary_intent === 'ask_financing' && acceptedExtractorConfidence(semantics.confidence) && literal(value, semantics.primary_evidence)
}

export function rememberSalesReply(previous: unknown, history: unknown, current: string, reply: string, turn?: CommercialEngagementTurn,
  delivered?: { writerReceipts?: Row; pendingQuestion?: Row }) {
  void reply
  const remembered = salesMemory(previous, history)
  const receipt = object(delivered?.writerReceipts), pending = object(delivered?.pendingQuestion)
  const questionId = text(pending.id || pending.continuation_id), act = text(pending.act || pending.continuation_act)
  const lastPending = object(turn?.pendingQuestion || object(turn?.intent).pending_question)
  const answer = object(object(turn?.semantics).answer_to_previous)
  const declined = lastPending.id === 'visit_invitation' && lastPending.act === 'visit' && answer.question_id === lastPending.id
    && answer.kind === 'negative' && acceptedExtractorConfidence(answer.confidence) && literal(current, answer.evidence)
  const engagement = commercialEngagement(current, history, previous, turn)
  return { ...remembered,
    visit_invited: remembered.visit_invited || receipt.visit_invited === true || questionId === 'visit_invitation' && act === 'visit',
    visit_declined: remembered.visit_declined || declined,
    financing_mentioned: remembered.financing_mentioned || receipt.financing_mentioned === true
      || receipt.offered_action === 'financing_review' || questionId.startsWith('financing_') && act === 'financing',
    unit_options_offered: remembered.unit_options_offered || receipt.unit_options_offered === true
      || questionId === 'unit_choice' || questionId === 'property_requirements' && act === 'explore_alternatives',
    passive_sales: engagement.passive, property_interest: engagement.interested,
    ...(turn ? { engagement_version: COMMERCIAL_ENGAGEMENT_VERSION, interaction_mode: engagement.interaction_mode } : {}),
  }
}

export function salesTopics(current: string, interpreted: unknown = {}) {
  const topics = currentRequests(interpreted, current).flatMap(request => Array.isArray(request.topics) ? request.topics.map(text) : [])
  const mapping: Record<string, string> = { gardens: 'jardines', location: 'sector', surroundings: 'sector', resale: 'reventa', purchase_process: 'compra' }
  return [...new Set(topics.map(topic => mapping[topic]).filter(Boolean))]
}

export function salesPlan(info: Row, current: string, summary: Row) {
  const history = rows(info.historial), memory = salesMemory(summary._sales_memory, history)
  const engagement = commercialEngagement(current, history, summary._sales_memory, {
    semantics: info.semantica_turno, intent: info.contrato_turno,
    scope: object(info.contrato_turno).scope, pendingQuestion: object(info.contrato_turno).pending_question,
  })
  const topics = salesTopics(current, info)
  const pendingVisit = rows(info.propuestas).some(proposal => ['confirmed', 'awaiting_advisor', 'awaiting_client'].includes(text(proposal.status)))
    || object(info.coordinacion_visita).status === 'collecting'
  const policy = object(info.politica_visitas)
  const visits = botVisitPolicy({ bot_visits: { allow_suggestions: policy.allowSuggestions, launch_destination: policy.launchDestination } }, text(info.modo_comercial))
  if (policy.readiness) visits.readiness = policy.readiness as NonNullable<typeof visits.readiness>
  const journey = commercialJourneyPlan({ ...info, mensaje_actual: current, recorrido_comercial: summary._commercial_journey || {}, _sales_memory: memory, commercial_engagement: engagement })
  const answeringObjection = journey.action === 'answer_current_question' && projectObjectionRequests(info, current).length > 0
  const invite = journey.visit_offer_allowed === true && !engagement.passive && visits.allowSuggestions && !pendingVisit && !memory.visit_declined
  const offerUnits = !answeringObjection && !engagement.passive && !pendingVisit
    && ['offer_units', 'present_unit_options'].includes(text(journey.action))
  const shareBrochure = !answeringObjection && !engagement.passive && journey.action === 'offer_brochure'
    && object(info.estado_conversacion).brochure_sent !== true
  const answerOnly = answeringObjection || engagement.passive || pendingVisit
    || !text(journey.question_id) || journey.continuation_optional === true
  return { action: invite ? 'invite_visit' : offerUnits ? 'offer_units' : shareBrochure ? 'share_brochure' : answerOnly ? 'answer_only' : 'discover', topics,
    question_purpose: invite ? 'Obtener permiso para coordinar la visita, sin confirmarla.'
      : offerUnits ? 'Comparar las opciones realmente ofrecidas.' : answerOnly ? null : text(journey.instruction),
    max_questions: invite || offerUnits || !answerOnly ? 1 : 0,
    optional_objection_question: answeringObjection,
    closing: invite ? visitInvitation(text(info.modo_comercial), visits) : '',
    visits_allowed: visits.allowSuggestions, launch: info.modo_comercial === 'lanzamiento',
    memory, engagement, positive_after_model: false,
    rules: `Responda primero todas las consultas del turno. El siguiente paso procede de la interpretacion actual y del recorrido comercial estructurado, nunca de palabras detectadas en respuestas anteriores.
No inicie calificacion por faltar categoria, presupuesto, dormitorios o perfil. Ante un saludo ofrezca ayuda abierta; ante una intervencion ambigua aclare que desea consultar. Conserve datos, preferencias y gestiones ya registrados.
Siga el objetivo comercial autorizado, con redaccion propia. Una consulta informativa no concede permiso para visitas, financiamiento o reserva. No copie ni agregue automaticamente la pregunta de una respuesta anterior.
El redactor entrega el mensaje completo: el codigo no incorporara una invitacion, despedida ni pregunta despues. Ofrezca solo acciones autorizadas por siguiente_paso_comercial y no anuncie confirmaciones sin un registro operativo que las respalde.
${passiveSalesRules(engagement)}` }
}

/** No deterministic reviewer is allowed to infer business meaning from a draft. */
export function salesIssues(reply: string, plan: ReturnType<typeof salesPlan>): string[] {
  void reply
  void plan
  return []
}

/** Topic interpretation and writing belong to the existing model call. */
export function salesTopicReply(info: Row, current: string) {
  void info
  void current
  return ''
}
