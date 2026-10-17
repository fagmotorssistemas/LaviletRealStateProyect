import { actionAuthorized, actionDecision, normalizedActionAuthority } from './action-authority'
import { readCommercialContext } from './context-read'
import { db,object,scope,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { hasFinancingRequest } from './financing-guidance'
import { operationalFinancingInvitation } from './financing-invitation'
import { financingQuoteInquiry } from './financing-quote'
import { normalized } from './sdr-rules'

export const FINANCING_PARTNER_CHOICE_SCHEMA = { type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', enum: ['select', 'decline', 'none'] }, name: { type: ['string', 'null'] },
    reference_kind: { type: 'string', enum: ['explicit', 'contextual', 'none'] },
    evidence: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['kind', 'name', 'reference_kind', 'evidence', 'confidence'] }
export const FINANCING_PARTNER_CHOICE_RULES = 'financing_partner_choice distingue elegir una entidad (select), rechazarla (decline) y mencionar/preguntar por ella (none). Nombre canónico y evidencia literal ACTUAL; no arrastre la entidad del historial. reference_kind=explicit cuando identifica la entidad en su propio mensaje, incluso con faltas evidentes de escritura; contextual cuando acepta una oferta inequívoca de UNA entidad concreta sin nombrarla; none cuando no elige ni rechaza. No resuelva un sí entre varias entidades. Resuelva contrastes y cambios de preferencia. La elección se conserva aunque falte unidad o perfil, pero no otorga consentimiento financiero. Una duda, condición pendiente o consulta de requisitos no elige ni acepta revisión: conserve la incertidumbre en los actos correspondientes.'

export async function financingContext(lead: Row) {
  const { partners, qualification } = await readCommercialContext({
    partners: () => db().from('project_financing_partners').select('public_enabled,test_only,test_phone,public_name,financing_options')
      .match(scope).eq('public_enabled', true).abortSignal(AbortSignal.timeout(10_000)),
    qualification: () => db().from('financing_prequalifications').select('explicit_consent,selected_partner_name,status,job_title,employment_stability_months,applicant_type,monthly_income,legal_name,legal_name_confirmed,national_id,updated_at')
      .match(scope).eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(10_000)),
  })
  const digits = (value: unknown) => text(value).replace(/\D/g, '')
  const eligible = (Array.isArray(partners.data) ? partners.data.map(object) : []).filter(p => p.test_only !== true || (digits(lead.phone) && digits(lead.phone) === digits(p.test_phone)))
  // Project agreements are authoritative; do not advertise entries from the global bank catalog.
  const names = [...new Set(eligible.flatMap(p => (Array.isArray(p.financing_options) ? p.financing_options : [])
    .map(option => text(object(option).name)).filter(Boolean)))]
  return { partners: names, current: object(Array.isArray(qualification.data) ? qualification.data[0] : undefined) }
}

/** A current interpreted budget concern informs guidance, never permission. */
export function hasAffordabilityConcern(current: string, interpreted: Row = {}) {
  const semantics = object(interpreted.turn_semantics || interpreted.semantica_turno || interpreted)
  const budget = object(semantics.budget)
  return budget.status === 'insufficient_for_selected_unit' && acceptedExtractorConfidence(budget.confidence)
    && currentLiteral(budget.evidence, current)
}

const currentLiteral = (quote: unknown, current: string) => !!text(quote).trim()
  && current.normalize('NFKC').toLowerCase().includes(text(quote).trim().normalize('NFKC').toLowerCase())
const requestsFor = (extracted: Row) => [extracted.requests, object(extracted.turn_semantics).requests]
  .flatMap(value => Array.isArray(value) ? value.map(object) : [])
const partnerAlias = (value: string) => normalized(value).replace(/^(?:banco|cooperativa)\s+/, '')

export function financingInputs(extracted: Row, current: string, lastReply: string, context: Awaited<ReturnType<typeof financingContext>>, lastStep: Row = {}) {
  const semantics = object(extracted.turn_semantics)
  const choice = object(extracted.financing_partner_choice)
  const pendingAnswer = object(semantics.answer_to_previous)
  const literal = (value: unknown) => currentLiteral(value, current)
  const currentFinancialRequest = hasFinancingRequest(extracted) && (
    semantics.primary_intent === 'ask_financing' && literal(semantics.primary_evidence)
    || requestsFor(extracted).some(request => request.source !== 'pending' && request.domain === 'financing'
      && acceptedExtractorConfidence(request.confidence) && literal(request.evidence)))
  const otherQuestion = acceptedExtractorConfidence(pendingAnswer.confidence) && !!pendingAnswer.question_id
    && !['none', 'financing_invitation'].includes(text(pendingAnswer.question_id))
    || lastStep.kind === 'commercial_question' && lastStep.reply === lastReply
  const asksConsent = !otherQuestion && lastStep.kind === 'financing_consent'
    && lastStep.reply === lastReply && operationalFinancingInvitation(lastStep.invitation)
  const answerEvidence = text(pendingAnswer.evidence).trim()
  const currentAnswer = !!answerEvidence && normalized(current).includes(normalized(answerEvidence))
  const groundedInvitation = asksConsent && pendingAnswer.question_id === 'financing_invitation'
    && acceptedExtractorConfidence(pendingAnswer.confidence) && currentAnswer
  const authority = normalizedActionAuthority(extracted.action_authority || semantics.action_authority, current)
  const semanticAcceptance = actionAuthorized(authority, 'financing') && groundedInvitation && pendingAnswer.kind === 'affirmative'
  const currentConsent = actionAuthorized(authority, 'financing') && actionDecision(authority, 'financing').decision === 'request'
  const choiceEvidence = text(choice.evidence).trim()
  const groundedChoice = acceptedExtractorConfidence(choice.confidence) && !!choiceEvidence && choiceEvidence.length <= 500
    && literal(choiceEvidence)
  const declined = groundedInvitation && pendingAnswer.kind === 'negative'
    || extracted.financing_consent === false && currentFinancialRequest
  // A new authorization belongs to the current AI interpretation. Keywords in
  // a status inquiry cannot start another review, and choosing a lender alone
  // is not consent. A grounded answer can accept the delivered typed invitation
  // without depending on either model's particular wording.
  const inquiry = financingQuoteInquiry(extracted, current)
  const consent = inquiry.beforeApplication || declined ? null
    : semanticAcceptance || currentConsent ? true : null
  // A name is canonical data; selecting/declining it is the interpreter's act.
  // Merely finding an institution's words in the message cannot choose it.
  const canonical = context.partners.find(name => normalized(text(choice.name)) === normalized(name)
    || partnerAlias(text(choice.name)) === partnerAlias(name))
  const explicitReference = choice.reference_kind === 'explicit'
  const contextualReference = choice.reference_kind === 'contextual' && pendingAnswer.question_id === 'financing_partner'
    && acceptedExtractorConfidence(pendingAnswer.confidence) && ['affirmative', 'value'].includes(text(pendingAnswer.kind))
    && currentAnswer && context.partners.length === 1 && canonical === context.partners[0]
  const resolvedChoice = groundedChoice && (explicitReference || contextualReference)
  const partner = resolvedChoice && canonical && choice.kind === 'select' ? canonical : ''
  const clearedPartner = resolvedChoice && canonical && choice.kind === 'decline' ? canonical : ''
  const unsupported = groundedChoice && choice.kind === 'select' && !canonical && !!text(choice.name).trim() ? text(choice.name) : ''
  return { consent, partner: unsupported ? null : partner || null, unsupported: inquiry.beforeApplication ? '' : unsupported,
    partner_evidence: partner ? groundedChoice ? choiceEvidence : current : '', cleared_partner: clearedPartner || null,
    ...(declined ? { declined: true } : {}) }
}

/** A grounded answer supplying a lender is intake data, not a new question
 * about financing. Consent and property prerequisites are checked by the caller. */
export function financingPartnerAnswer(extracted: Row, input: { partner?: string | null }) {
  const semantics = object(extracted.turn_semantics), answer = object(semantics.answer_to_previous)
  // answer_to_previous is already bound to the actual pending question by the
  // interpreter. A broad ask_financing label must not discard a lender choice.
  return !!input.partner && answer.question_id === 'financing_partner'
    && acceptedExtractorConfidence(answer.confidence) && answer.kind === 'value'
}

/** Describe missing fields from the persisted RPC result, never from prose. */
export function financingPendingFields(fin: Row): string[] {
  return [
    !fin.selected_partner_name && 'selected_partner_name',
    !(fin.full_name && fin.legal_name_confirmed === true) && 'legal_name',
    !fin.national_id && 'national_id',
    !fin.applicant_type && 'applicant_type',
    fin.applicant_type === 'empleado' && fin.employment_stability_months == null && 'employment_stability_months',
    fin.applicant_type === 'empleado' && !fin.job_title && 'job_title',
    fin.monthly_income == null && 'monthly_income',
  ].filter((field): field is string => typeof field === 'string')
}

export function financingPendingQuestion(reply: string, audit: Row): Row {
  const collection = object(audit.financing_collection), state = text(collection.state)
  if (!state.endsWith('_pendiente') || state === 'continuacion_pendiente') return {}
  const lenderRequested = Array.isArray(collection.requested_fields)
    ? collection.requested_fields.includes('selected_partner_name') : state === 'entidad_pendiente'
  return { id: lenderRequested ? 'financing_partner' : 'financing_data', act: 'financing',
    question: reply.trim().slice(0, 500), requested_fields: collection.requested_fields, target_ids: [], candidate_ids: [] }
}

export function financingReply(fin: Row, partners: string[], unsupported = '') {
  const options = partners.join(' o ')
  if (unsupported) return options
    ? `Por ahora no trabajamos con ${unsupported}. Podemos ayudarle a revisar un crédito con ${options}. ¿Le gustaría explorar esa alternativa?`
    : `Por ahora no trabajamos con ${unsupported}. Podemos consultar con el equipo qué alternativas hay. ¿Le gustaría que le ayuden?`
  const messages: Record<string, string> = {
    entidad_pendiente: options ? `Podemos continuar con ${options}. ¿Con cuál le gustaría revisar su financiamiento?` : 'El equipo puede ayudarle a confirmar las entidades disponibles. ¿Le gustaría que le contacten?',
    identificacion_pendiente: 'Para la revisión, ¿me indica su nombre completo y número de cédula, por favor?',
    nombre_pendiente: '¿Me confirma su nombre completo para la revisión?', cedula_pendiente: '¿Me indica su número de cédula, por favor?',
    tipo_solicitante_pendiente: '¿Trabaja bajo relación de dependencia o de manera independiente?',
    estabilidad_pendiente: '¿Cuánto tiempo lleva trabajando en su empleo actual?', cargo_pendiente: '¿Cuál es su cargo actual?',
    ingreso_pendiente: '¿Cuál es su ingreso mensual aproximado?',
    lista_para_revision: 'Ya tenemos los datos iniciales para que el equipo revise su caso.',
    continuacion_pendiente: fin.selected_partner_name
      ? `Podemos continuar con ${text(fin.selected_partner_name)}. ¿Le gustaría que iniciemos la revisión de su caso?`
      : options
      ? `Podemos ayudarle a revisar un crédito con ${options}. ¿Le gustaría que iniciemos una revisión de su caso?`
      : 'Sí, podemos ayudarle a revisar las opciones de financiamiento. ¿Le gustaría que el equipo le oriente?',
  }
  const reply = messages[text(fin.state || fin.financing_state)]
  if (!reply) throw new Error('UNKNOWN_FINANCING_STATE')
  return reply
}

// An existing qualification is saved progress, not permission to monopolize every turn.
export function isFinancingTurn(extracted: Row, current: string, _lastReply: string, input: { partner: string | null; unsupported: string }) {
  void _lastReply // Conversation routing uses structured interpretation, never the writer's wording.
  if (extracted.requested_advisor || extracted.opt_out) return false
  if (hasFinancingRequest(extracted)) return true
  if (input.partner || input.unsupported) return true
  const answer = object(object(extracted.turn_semantics).answer_to_previous)
  return ['financing_invitation', 'financing_partner', 'financing_data', 'financing_down_payment'].includes(text(answer.question_id))
    && acceptedExtractorConfidence(answer.confidence) && ['affirmative', 'value'].includes(text(answer.kind))
    && currentLiteral(answer.evidence, current)
    || ['national_id', 'applicant_type', 'employment_stability_months', 'job_title', 'monthly_income', 'ruc']
      .some(key => extracted[key] != null)
}

export function financingQuestionReply(current: string, partners: string[], _lastReply = '', extracted: Row = {}) {
  void _lastReply // References are interpreted upstream, not read from writer prose.
  if (financingQuoteInquiry(extracted, current).requested) return 'La entrada del proyecto y la aportación propia para el crédito se revisan por separado. Las cifras disponibles proceden de las condiciones vigentes de cada entidad y de la unidad que le interesa; los ejemplos calculados identifican sus supuestos.'
  const requests = requestsFor(extracted).filter(request => request.domain === 'financing'
    && acceptedExtractorConfidence(request.confidence) && currentLiteral(request.evidence, current))
  const topics = requests.flatMap(request => Array.isArray(request.topics) ? request.topics : [])
  if (topics.includes('credit_approval')) {
    return 'Le acompañamos en el proceso, pero no podemos asegurar la aprobación del crédito. La entidad necesita revisar su caso para confirmarla.'
  }
  const reviewDetails = 'Podemos explicarle y acompañarle en una revisión preliminar por este chat. Después de aceptar continuar, consultamos cuánto tendría disponible para la entrada si todavía falta ese dato y después definimos la unidad de su interés, conservando una unidad ya elegida. Si aún no define la entrada, podemos seguir orientándole. Elegimos una entidad únicamente si todavía no la indicó y después solicitamos nombres completos, número de cédula y si trabaja como dependiente o independiente. Luego se solicitan los datos laborales e ingresos correspondientes a su situación. El equipo interno revisará su caso y la entidad confirmará sus requisitos y condiciones.'
  if (hasFinancingRequest(extracted)) return partners.length
    ? `Podemos explorar opciones con ${partners.join(' o ')}. ${reviewDetails}`
    : 'Todavía no hay una entidad confirmada para iniciar la revisión. Podemos explicar el proceso preliminar, pero las alternativas y los requisitos aplicables deben confirmarse antes de solicitar datos.'
  return ''
}

export function avoidFinancingRepeat(reply: string, current: string, lastReply: string, fin: Row, partners: string[]) {
  // Historical compatibility only. Writer wording is never replaced by code.
  void current; void lastReply; void fin; void partners
  return reply
}

// A combined price/financing question needs information, not an application.
export function priceFinancingReply(current: string, context: Awaited<ReturnType<typeof financingContext>>, extracted: Row = {}) {
  const question = financingQuestionReply(current, context.partners, '', extracted)
  if (question) return question
  const choice = financingInputs(extracted, current, '', context)
  if (choice.unsupported) return context.partners.length
    ? `Las entidades habilitadas actualmente son ${context.partners.join(' y ')}; la entidad indicada necesita revisión del equipo.`
    : 'El equipo puede comprobar las alternativas bancarias vigentes.'
  if (choice.partner) return `Podemos revisar el financiamiento con ${choice.partner} y acompañarle en el proceso.`
  return ''
}
