import { responseSupportsContinuity } from '@/lib/inmobiliaria/responseReview'
import { object, text, type Row } from './data'
import { isGreetingOnly, normalized } from './sdr-rules'
import { conversationalFirstName, isCourtesyOnly } from './conversation-style'
import { BROCHURE_URL, brochureDeliveryIntent } from './project-material'
import { confirmedLeadProfile, mergeLeadProfile } from './lead-profile'
import { replyQuestions } from './reply-question'
import { continuationMetadata } from './continuation-question'

export const PROFILE_INVITATION = 'Para enviarle el brochure digital completo con los planos y brindarle una guía personalizada, ¿podría indicarnos su nombre y en qué ciudad o país reside actualmente?'
const BROCHURE_PURPOSE = 'Para enviarle el brochure digital completo con los planos y brindarle una guía personalizada, '
const PROJECT_INTRODUCTION = 'Claro que sí, con mucho gusto. La Vilet es un proyecto inmobiliario ubicado en Puertas del Sol, Cuenca, que propone vivir con tranquilidad, privacidad y comodidad.'
const CATEGORY_LABELS: Record<string, string> = { suite: 'suites', departamento: 'departamentos', penthouse: 'penthouses', local: 'locales comerciales', local_comercial: 'locales comerciales' }
const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : []
const join = (...parts: string[]) => parts.filter(part => part.trim()).join('\n\n')

export type LeadIntroductionInput = {
  current: string; history?: unknown; summary?: unknown; extracted?: unknown; profile?: unknown
  reply: string; audit?: unknown; projectInfo?: unknown; catalog?: unknown; brochureUrl?: string
}

function missingFields(profile: Row) {
  return [!text(profile.full_name).trim() && 'full_name',
    !text(profile.residence_city).trim() && !text(profile.residence_country).trim() && 'residence'].filter(Boolean) as string[]
}
function profileQuestion(missing: string[], delivered: boolean) {
  const question = missing.length === 2 ? '¿podría indicarnos su nombre y en qué ciudad o país reside actualmente?'
    : missing[0] === 'full_name' ? '¿podría indicarnos su nombre?'
      : '¿podría indicarnos en qué ciudad o país reside actualmente?'
  return (delivered ? 'Con el brochure que le compartimos y para brindarle una guía personalizada, ' : BROCHURE_PURPOSE) + question
}
function requestedFields(prior: Row): string[] {
  return Array.isArray(prior.requested_fields)
    ? prior.requested_fields.filter((field): field is string => field === 'full_name' || field === 'residence') : []
}

function profileRequestWasSent(prior: Row) {
  // Legacy pending exchanges are retained; an old "complete" presentation or
  // a brochure alone does not establish that any profile question was sent.
  return prior.request_sent === true || requestedFields(prior).length > 0
    || Number(prior.version || 2) < 3 && (prior.status === 'pending' || Number(prior.reminder_count) > 0 || prior.confirmation_asked === true)
}

function collectionStatus(profile: Row, prior: Row, declined = false) {
  if (!missingFields(profile).length) return 'complete'
  if (declined || prior.collection_status === 'declined' || prior.status === 'skipped') return 'declined'
  return profileRequestWasSent(prior) ? prior.status === 'pending' ? 'awaiting' : 'deferred' : 'not_requested'
}
function withoutBrochure(reply: string, url: string) {
  return reply.split(/(?<=[.!?])\s+|\n+/).filter(sentence => !/brochure|folleto/i.test(sentence)
    && !sentence.includes(url) && !sentence.includes(BROCHURE_URL)).join(' ').trim()
}
function lastQuestion(reply: string) { return reply.match(/¿[^¿?]+\?\s*$/)?.[0].trim() || '' }
function withoutLastQuestion(reply: string) { return reply.replace(/\s*¿[^¿?]+\?\s*$/, '').trim() }
function generalInformation(current: string, audit: Row) {
  return ['project_overview', 'project_information_choice'].includes(text(audit.source))
    || /^(?:(?:hola|buenos dias|buenas tardes|buenas noches|por favor|me gustaria|quiero|quisiera|necesito|deseo|mas|un poco de|de|del|sobre|el|la|vilet|proyecto)\s+)*(?:informacion|info|informes)(?:\s+(?:general|del|de|proyecto|la|vilet|por favor))*$/.test(normalized(current))
}
function explicitBrochure(current: string) {
  const value = normalized(current)
  return /brochure|brochur|folleto|\bpdf\b/.test(value) && !/\bno\b.{0,25}(?:quiero|necesito|envie|mande|brochure|folleto)/.test(value)
}
function concreteRequest(current: string) {
  return /precio|cuesta|cuestan|vale|valor|presupuesto|monto|dispongo|financ|credito|cuota|departamento|departmento|suite|penthouse|local|inver|vivir|dormitorio|habitacion|cuarto|visita|agend|reserv|ubicacion|direccion|constru|terminad|entrega|plano|modelo|recorrido|brochure|folleto|piscina|gimnasio|terraza|parqueader|area|metros|tamano|ampli|grande|espacio|opciones|informacion/.test(normalized(current))
}
function interpretedCommercialRequest(extracted: Row, audit: Row) {
  const semantics = object(extracted.turn_semantics)
  const intent = object(audit.resolved_turn_intent)
  const requests = Array.isArray(intent.requests) ? intent.requests
    : Array.isArray(extracted.requests) ? extracted.requests : Array.isArray(semantics.requests) ? semantics.requests : []
  return semantics.confidence === 'high' && ['ask_price', 'ask_financing', 'discuss_budget', 'select_property', 'project_information', 'ask_reservation'].includes(text(semantics.primary_intent))
    || requests.map(object).some(request => ['property', 'financing'].includes(text(request.domain)) && request.confidence === 'high')
}
function protectedCurrentOperation(audit: Row, extracted: Row) {
  const semantics = object(extracted.turn_semantics), intent = object(audit.resolved_turn_intent)
  const scope = object(intent.scope), reservation = object(audit.reservation)
  const action = text(audit.action)
  const informationalAction = action === 'information_only' || action === 'none'
    || action !== '' && action === object(semantics.property).operation
  // These are workflow decisions, not names of informational reply routes.
  // A new catalogue or project-information route must not bypass the opening.
  return audit.source === 'financing' || /^(?:visit|advisor|reservation_handoff|financing_handoff)/.test(text(audit.source))
    || Boolean(action && !informationalAction) || audit.registration_verified === true
    || reservation.kind === 'request' || reservation.handoff_verified === true
    || semantics.confidence === 'high' && ['request_visit', 'request_reservation'].includes(text(semantics.primary_intent))
    || extracted.requested_advisor === true
    || ['out_of_scope', 'mixed', 'uncertain'].includes(text(audit.business_scope))
    || ['out_of_scope', 'mixed'].includes(text(scope.kind)) || scope.uncertain === true
}
export function isProfileOnlyTurn(current: string, extractedRaw: unknown) {
  const extracted = object(extractedRaw), semantics = object(extracted.turn_semantics)
  const currentCommercialIntent = ['ask_price', 'ask_financing', 'discuss_budget', 'request_visit', 'select_property', 'project_information'].includes(text(semantics.primary_intent))
    && semantics.confidence === 'high'
  const budget = object(semantics.budget)
  return !currentCommercialIntent && !(budget.confidence === 'high' && budget.status !== 'not_discussed')
    && !concreteRequest(current) && (hasProfileAnswer(extracted.lead_profile) || declinedProfile(current))
}
function declinedProfile(current: string) {
  return /(?:no quiero|no deseo|prefiero no|no voy a|no le voy a).{0,35}(?:dar|decir|compartir|nombre|datos|resido|vivo)|(?:no importa|no es necesario).{0,20}(?:nombre|donde|datos)/.test(normalized(current))
}
function knownProfile(input: LeadIntroductionInput) {
  return confirmedLeadProfile(mergeLeadProfile(confirmedLeadProfile({ ...object(object(input.summary)._lead_profile), ...object(input.profile) }), confirmedLeadProfile(object(input.extracted).lead_profile)))
}

export function hasProfileAnswer(raw: unknown) {
  const profile = object(raw)
  return ['full_name', 'residence_city', 'residence_country'].some(key => text(profile[key]).trim())
    || Object.keys(object(profile.declared_location)).length > 0 || Object.keys(object(profile.residence_confirmation)).length > 0
    || profile.residence_status === 'declined'
}

function nameAcknowledgement(profile: Row, prior: Row) {
  const name = conversationalFirstName(text(profile.full_name))
  return name && normalized(name) !== normalized(text(prior.acknowledged_name))
    ? `Mucho gusto, ${name[0].toLocaleUpperCase('es') + name.slice(1)}.` : ''
}

function questionPurpose(missing: string[]) {
  return missing.length === 2 ? 'collect_profile' : missing[0] === 'full_name' ? 'collect_name' : 'collect_residence'
}

function profileQuestionId(purpose: unknown) {
  return purpose === 'confirm_residence' ? 'lead_residence_confirmation'
    : purpose === 'collect_profile' ? 'lead_profile' : purpose === 'collect_name' ? 'lead_profile_name'
      : purpose === 'collect_residence' ? 'lead_profile_residence' : ''
}

/** Missing data is not permission to request it. This decision is shared by the
 * writer, reviewer and delivered-question receipt, including deferred turns. */
export function leadProfileCollectionDecision(planRaw: unknown, profileRaw: unknown = {}, previousRaw: unknown = {}): Row {
  const plan = object(planRaw), profile = confirmedLeadProfile(profileRaw), previous = object(previousRaw)
  const purpose = text(plan.question_purpose), id = profileQuestionId(purpose)
  const missing = missingFields(profile)
  const declined = plan.profile_declined === true || profile.residence_status === 'declined'
    || previous.collection_status === 'declined' || previous.status === 'skipped'
  const action = declined ? 'declined' : purpose === 'confirm_residence' ? 'confirm'
    : id ? profileRequestWasSent(previous) ? 'remind' : 'capture' : missing.length ? 'defer' : 'complete'
  const allowed = declined ? [] : id ? [id] : []
  return { version: 'profile-collection-v1', action, question_purpose: purpose || 'none',
    requires_question: allowed.length > 0, allowed_question_ids: allowed,
    allowed_fields: allowed.length ? purpose === 'collect_profile' ? ['full_name', 'current_residence']
      : purpose === 'collect_name' ? ['full_name'] : ['current_residence'] : [],
    missing_fields: missing, reminder_limit: 1, reminders_sent: Number(previous.reminder_count) || 0,
    reason: text(plan.collection_reason) || (declined ? 'profile_declined' : action === 'complete' ? 'profile_complete'
      : action === 'capture' ? 'first_profile_request' : action === 'remind' ? 'partial_profile_answer'
        : action === 'confirm' ? 'declared_location_confirmation' : 'continue_current_need') }
}

/** Validate the independently identified question, never vocabulary or a
 * template. Formal financing collection has its own separate authorization. */
export function leadProfileQuestionIssues(questionRaw: unknown, auditRaw: unknown): string[] {
  const question = object(questionRaw), audit = object(auditRaw), plan = object(audit.profile_introduction)
  const decision = object(audit.profile_collection_decision || plan.collection_decision)
  if (decision.version !== 'profile-collection-v1') return []
  const semantic = continuationMetadata(question), id = text(semantic.continuation_id)
  const isProfile = id.startsWith('lead_') || question.purpose === 'collect_lead_profile'
  if (!isProfile) return []
  const allowed = Array.isArray(decision.allowed_question_ids) ? decision.allowed_question_ids : []
  if (!allowed.length) return ['lead_profile_question_not_authorized']
  return Object.hasOwn(question, 'continuation_id') && !allowed.includes(id)
    ? ['lead_profile_question_mismatch'] : []
}

/** Persist the referent of the question actually sent, including paraphrases. */
export function leadProfilePendingQuestion(reply: string, auditRaw: unknown): Row {
  const audit = object(auditRaw), plan = object(audit.profile_introduction)
  const purpose = text(plan.question_purpose)
  const review = object(audit.turn_completeness)
  if (Object.keys(review).length && !responseSupportsContinuity(review)) return {}
  if (leadProfileQuestionIssues(review.question, audit).length) return {}
  const semanticQuestion = continuationMetadata(review.question)
  if (Object.keys(semanticQuestion).length && !text(semanticQuestion.continuation_id).startsWith('lead_')) return {}
  if (!purpose || purpose === 'none' || leadIntroductionIssues(reply, auditRaw).some(issue => /question|confirmation/.test(issue))) return {}
  const question = replyQuestions(reply).join(' ')
  if (!question) return {}
  const id = profileQuestionId(purpose)
  if (Object.keys(semanticQuestion).length && semanticQuestion.continuation_id !== id) return {}
  return { id, act: 'profile', question, ...(purpose === 'confirm_residence' ? { residence_candidate: object(plan.candidate) } : {}) }
}

/** Commit only after the provider accepted the reviewed response. Presentation
 * progress and confirmed profile completeness are deliberately separate. */
export function rememberLeadIntroduction(input: {
  previous: unknown; planned: unknown; profile: unknown; reply: string; audit: unknown;
  accepted: boolean; followUpUsable: boolean; recovery?: boolean;
}): Row {
  const previous = object(input.previous), audit = object(input.audit), plan = object(audit.profile_introduction)
  if (!input.accepted || input.recovery || !responseSupportsContinuity(audit.turn_completeness)) return previous
  const brochureDelivered = input.reply.includes(text(plan.brochure_url) || text(audit.brochure_url) || BROCHURE_URL)
  if (!input.followUpUsable) return brochureDelivered ? { ...previous, brochure_sent: true } : previous
  const profile = confirmedLeadProfile(input.profile), planned = object(input.planned)
  if (!Object.keys(plan).length) return Object.keys(previous).length || brochureDelivered
    ? { ...previous, ...(brochureDelivered ? { brochure_sent: true } : {}), collection_status: collectionStatus(profile, previous), missing_fields: missingFields(profile) } : previous
  const question = leadProfilePendingQuestion(input.reply, audit)
  const delivered = !!text(question.id), purpose = text(plan.question_purpose)
  const expected = purpose && purpose !== 'none'
  // An omitted question must not acquire a pending state or consume a reminder.
  const state = delivered || !expected ? { ...previous, ...planned } : { ...previous }
  const requested = delivered ? purpose === 'collect_profile' ? ['full_name', 'residence']
    : purpose === 'collect_name' ? ['full_name'] : ['residence'] : []
  state.version = 3
  state.requested_fields = [...new Set([...requestedFields(previous), ...requested])]
  state.request_sent = delivered || profileRequestWasSent(previous)
  state.status = delivered ? 'pending' : expected ? previous.status || 'not_started' : state.status || 'not_started'
  state.missing_fields = missingFields(profile)
  if (!missingFields(profile).length) state.status = 'complete'
  state.collection_status = collectionStatus(profile, state, plan.profile_declined === true)
  state.brochure_sent = previous.brochure_sent === true || brochureDelivered
  state.reminder_count = delivered ? planned.reminder_count || 0 : previous.reminder_count || 0
  state.confirmation_asked = question.id === 'lead_residence_confirmation' || previous.confirmation_asked === true
  state.confirmation_candidate = question.id === 'lead_residence_confirmation'
    ? question.residence_candidate : previous.confirmation_candidate || null
  const acknowledgement = text(plan.name_acknowledgement)
  if (acknowledgement && normalized(input.reply).includes(normalized(acknowledgement))) {
    state.acknowledged_name = text(profile.full_name).trim().split(/\s+/)[0]
  }
  return state
}
function catalogFor(input: LeadIntroductionInput) {
  return rows(input.catalog || object(input.projectInfo).catalogo || object(object(input.audit).catalog_results).units)
    .filter(unit => !['vendido', 'sold', 'reservado', 'reserved', 'unavailable'].includes(text(unit.status)))
}
function categoryFor(input: LeadIntroductionInput) {
  const extracted = object(input.extracted), semantic = object(extracted.turn_semantics)
  const category = text(extracted.preferred_category) || text(object(semantic.property).category)
    || text(object(object(semantic.property).filters).category)
  if (category in CATEGORY_LABELS) return category
  return Object.keys(CATEGORY_LABELS).find(key => new RegExp(`\\b${key === 'departamento' ? 'depart(?:a|e)mento' : key}s?\\b`).test(normalized(input.current))) || ''
}
function categoryIntroduction(input: LeadIntroductionInput, category: string) {
  const semantics = object(object(input.extracted).turn_semantics)
  // The introduction may shorten a category presentation, never replace a
  // resolved price/financing/detail answer merely because its wording varies.
  if (object(input.audit).source === 'unit_price'
    || semantics.confidence === 'high' && !['select_property', 'project_information'].includes(text(semantics.primary_intent))) return ''
  if (!category || /precio|cuesta|financ|cuota|credito|\d|dormitorio|habitacion|area|metro|tamano|grande|espacio|ampli|plano|visita|entrega|constru|ubicacion|direccion|piscina|terraza|parqueader|incluy|tiene|tienen|hay/.test(normalized(input.current))) return ''
  const units = catalogFor(input).filter(unit => unit.category === category)
  if (!units.length) return ''
  const bedrooms = [...new Set(units.map(unit => Number(unit.bedrooms)).filter(count => Number.isInteger(count) && count > 0))].sort((a,b) => a-b)
  const counts = new Intl.ListFormat('es', { style: 'long', type: 'conjunction' }).format(bedrooms.map(String))
  return `Claro que sí, con mucho gusto. En La Vilet contamos con ${CATEGORY_LABELS[category]}${bedrooms.length ? ` de ${counts} ${bedrooms.length === 1 && bedrooms[0] === 1 ? 'dormitorio' : 'dormitorios'}` : ''}.`
}
function commercialContinuation(input: LeadIntroductionInput, category: string, overview: boolean) {
  if (overview || !category) return 'La Vilet reúne suites, departamentos, penthouses y locales comerciales. ¿Le gustaría que le compartamos información de alguna de estas opciones?'
  const semanticFilters = object(object(object(input.extracted).turn_semantics).property)
  const previousFilters = object(object(object(object(input.summary)._property_context).query).filters)
  const bedroomsKnown = Number(object(input.extracted).preferred_bedrooms) > 0
    || Number(object(semanticFilters.filters).bedrooms) > 0 || Number(previousFilters.bedrooms) > 0
    || (Array.isArray(object(semanticFilters.filters).bedrooms_any) && (object(semanticFilters.filters).bedrooms_any as unknown[]).length > 0)
    || (Array.isArray(previousFilters.bedrooms_any) && previousFilters.bedrooms_any.length > 0)
    || /\b\d\s*(?:dormitorio|habitacion|cuarto)/.test(normalized(input.current))
  if (!bedroomsKnown && catalogFor(input).filter(unit => unit.category === category).some(unit => Number(unit.bedrooms) > 0)) return '¿Cuántos dormitorios está buscando?'
  return lastQuestion(input.reply) || '¿Qué le gustaría conocer de estas opciones?'
}

/** Plans the opening exchange without performing writes or changing the user's message. */
export function leadIntroductionTurn(input: LeadIntroductionInput) {
  const summary = object(input.summary), prior = object(summary._lead_introduction)
  const material = brochureDeliveryIntent(input.current, input.history, object(input.extracted), object(summary._pending_question))
  const audit: Row = { ...object(input.audit), brochure_intent: material }
  const extracted = object(input.extracted), profile = knownProfile(input), missing = missingFields(profile)
  const unchanged = { reply: input.reply, state: prior, audit, applied: false, brochureDeferred: false }
  const currentProfile = object(extracted.lead_profile)
  const suppliedProfile = hasProfileAnswer(currentProfile)
  const commercialRequest = interpretedCommercialRequest(extracted, audit)
  // A bare greeting keeps the short greeting route, including after a test reset.
  // Ask for the profile only once the lead expresses an actual request.
  if (!input.current.trim() || isGreetingOnly(input.current)
    || !suppliedProfile && !commercialRequest && isCourtesyOnly(input.current)) return unchanged
  const acknowledgement = nameAcknowledgement(profile, prior)
  const suppliedCandidate = Boolean(object(currentProfile.residence_candidate).city || object(currentProfile.residence_candidate).country)
    && profile.residence_status === 'pending_confirmation'
  const asked = profileRequestWasSent(prior)
  const declined = currentProfile.residence_status === 'declined' || profile.residence_status === 'declined'
    || declinedProfile(input.current) || prior.collection_status === 'declined' || prior.status === 'skipped'
  const deferredDecision = leadProfileCollectionDecision({ question_purpose: 'none', profile_declined: declined,
    collection_reason: declined ? 'profile_declined' : !missing.length ? 'profile_complete'
      : Number(prior.reminder_count || 0) >= 1 ? 'reminder_limit_reached' : 'continue_current_need' }, profile, prior)
  unchanged.audit.profile_collection_decision = deferredDecision
  const resumed = !declined && (suppliedCandidate
    || suppliedProfile && missing.length > 0 && asked && Number(prior.reminder_count || 0) < 1)
  const acknowledgeOnly = () => {
    if (!acknowledgement || !text(currentProfile.full_name)) return unchanged
    return { ...unchanged, applied: true, reply: join(acknowledgement, input.reply),
      audit: { ...audit, profile_introduction: { profile_state: profile, question_purpose: 'none',
        collection_decision: deferredDecision, name_acknowledgement: acknowledgement } } }
  }
  if (prior.collection_status === 'declined' || prior.status === 'skipped') return acknowledgeOnly()
  if (prior.status === 'complete' && !resumed && !declinedProfile(input.current)
    && (asked || !missing.length && prior.brochure_sent === true)) return acknowledgeOnly()
  const pending = prior.status === 'pending' || resumed, onlyProfile = pending && isProfileOnlyTurn(input.current, extracted)
  if (protectedCurrentOperation(audit, extracted)) return acknowledgeOnly()
  const url = input.brochureUrl || BROCHURE_URL
  const category = categoryFor(input), overview = generalInformation(input.current, audit)
  if (!pending && !overview && !category && !commercialRequest && !concreteRequest(input.current) && !explicitBrochure(input.current)) return acknowledgeOnly()
  const base = withoutBrochure(input.reply, url)
  const materialRequested = material.requested
  const deliver = pending || suppliedProfile || materialRequested || missing.length === 0 || declined
  const candidate = object(profile.residence_candidate)
  const candidatePlace = [text(candidate.city), text(candidate.country)].filter(Boolean).join(', ')
  const needsConfirmation = profile.residence_status === 'pending_confirmation' && Boolean(candidatePlace)
  const priorCandidate = object(prior.confirmation_candidate)
  const sameCandidate = normalized([text(priorCandidate.city), text(priorCandidate.country)].filter(Boolean).join(', ')) === normalized(candidatePlace)
  const confirm = !declined && needsConfirmation && suppliedProfile && !(prior.confirmation_asked === true && sameCandidate)
  // The first clarification is still the promised profile exchange. Do not
  // deliver the material while asking for the confirmation that precedes it.
  // This is a single-turn deferral, never an indefinite personal-data gate.
  const brochureDeferred = !deliver || confirm && prior.brochure_sent !== true && !materialRequested
  const deliverBrochure = deliver && material.reason !== 'declined' && !brochureDeferred && (prior.brochure_sent !== true || materialRequested)
  const brochure = deliverBrochure ? `Aquí tiene el brochure digital completo del proyecto: ${url}` : ''
  let question = '', purpose = 'none', result = '', reminderCount = Number(prior.reminder_count) || 0
  let state: Row
  if (!deliver) {
    question = profileQuestion(missing, prior.brochure_sent === true)
    purpose = questionPurpose(missing)
    result = join(overview ? PROJECT_INTRODUCTION : categoryIntroduction(input, category) || withoutLastQuestion(base), question)
    state = { ...prior, version: 3, status: 'pending', reminder_count: 0, brochure_sent: prior.brochure_sent === true,
      category, continuation_reply: commercialContinuation(input, category, overview) }
  } else {
    // A mixed profile/consultation answer may already advance the needs. Keep
    // its current commercial question while the one profile reminder is asked;
    // a prior generic presentation must not replace that newer continuation.
    const continuation = !onlyProfile && lastQuestion(base) || text(prior.continuation_reply)
      || commercialContinuation(input, category, overview)
    // Clarifying a supplied place is progress, not a second generic reminder.
    // Persist a separate limit so an evasive answer cannot cause an endless loop.
    const denial = object(currentProfile.residence_confirmation).decision === 'deny'
    const firstCapture = !asked && missing.length > 0 && !materialRequested
    const nameWithoutResidence = asked && !!text(currentProfile.full_name).trim()
      && missing.length === 1 && missing[0] === 'residence'
    const remind = !declined && (confirm || firstCapture || (onlyProfile || nameWithoutResidence) && missing.length > 0
      && (reminderCount < 1 || denial && prior.denial_followup_asked !== true))
    if (remind) {
      if (confirm) { question = `Entiendo que es de ${candidatePlace}. ¿Es también su lugar de residencia actual?`; purpose = 'confirm_residence' }
      else { question = profileQuestion(missing, true); purpose = questionPurpose(missing); if (asked) reminderCount += 1 }
    }
    const contextual = onlyProfile ? '' : overview && !pending ? PROJECT_INTRODUCTION : base
    result = join(remind ? withoutLastQuestion(contextual) : contextual, brochure, remind ? question : onlyProfile || overview ? continuation : '')
    state = { ...prior, version: 3, status: remind ? 'pending' : 'complete', reminder_count: reminderCount,
      brochure_sent: deliverBrochure || prior.brochure_sent === true, category: text(prior.category) || category, continuation_reply: continuation,
      ...(confirm ? { confirmation_asked: true, confirmation_candidate: candidate } : {}),
      ...(denial && remind ? { denial_followup_asked: true } : {}) }
  }
  result = join(acknowledgement, result)
  state.collection_status = collectionStatus(profile, state, declined)
  state.missing_fields = missing
  const stage = question ? asked ? 'reminder' : 'request' : 'deliver'
  const collectionDecision = leadProfileCollectionDecision({ question_purpose: purpose, profile_declined: declined,
    collection_reason: purpose !== 'none' ? purpose === 'confirm_residence' ? 'declared_location_confirmation'
      : asked ? 'partial_profile_answer' : 'first_profile_request' : declined ? 'profile_declined'
        : !missing.length ? 'profile_complete' : Number(prior.reminder_count || 0) >= 1 ? 'reminder_limit_reached'
          : suppliedProfile && !onlyProfile ? 'current_request_priority' : 'profile_request_ignored' }, profile, prior)
  state.collection_decision = collectionDecision.action
  return { reply: result, state, applied: true, brochureDeferred,
    audit: { ...audit, profile_collection_decision: collectionDecision, brochure_sent: deliverBrochure || prior.brochure_sent === true, profile_introduction: { stage, question, brochure_deferred: brochureDeferred,
      collection_decision: collectionDecision,
      brochure_required: deliverBrochure, brochure_url: url, generic_introduction: overview && !deliver,
      brochure_previously_sent: prior.brochure_sent === true,
      missing_fields: missing, reminder_count: reminderCount, residence_meaning: 'current_residence', profile_declined: declined,
      profile_state: profile, question_purpose: purpose, candidate: needsConfirmation ? { ...candidate } : null,
      name_acknowledgement: acknowledgement || null,
      reason: needsConfirmation ? 'declared_place_requires_current_residence_confirmation' : pending ? 'continue_opening_profile_exchange' : 'first_substantive_project_contact' } } }
}

export const LEAD_INTRODUCTION_RULES = `
APERTURA Y PERFIL DEL LEAD
- Esta secuencia es una regla comercial obligatoria y prevalece sobre las sugerencias generales de presentación, libertad editorial o cierre sin pregunta. El sistema decide la etapa y los datos pendientes; el redactor elige cómo expresarlos y el revisor comprueba su significado en el mensaje real.
- Siga estado_operativo.profile_introduction y su profile_state compartido con el extractor. Primero responda la consulta concreta y después formule una sola pregunta con question_purpose. Puede reformularla conservando los datos faltantes y el propósito de brochure más guía personalizada; no se exige copiar toda la frase. Solicite únicamente nombre y ciudad o país de residencia actual, nunca dirección domiciliaria, desde dónde escribe ni el lugar donde quiere comprar. Un intercambio anterior sobre otro tema no acredita que estos datos ya se hayan solicitado.
- profile_collection_decision autoriza la captura del turno. capture solicita los datos iniciales; remind permite una sola pregunta por el dato faltante cuando responde parcialmente al perfil, también cuando aporta nombre y consulta precios u otro detalle: responda primero la consulta y después pida únicamente la residencia pendiente. No añada simultáneamente otra pregunta comercial. La identificación de necesidades continúa después, conservando categorías, dormitorios y preferencias ya definidos. Una consulta sin aportar datos de perfil no autoriza repetir la captura. confirm aclara el lugar declarado; defer, declined y complete prohíben solicitar o confirmar datos de presentación. Que missing_fields contenga un dato no autoriza pedirlo. Si tras el único recordatorio no entrega la residencia o la rechaza, continúe con las necesidades conocidas sin insistir. Una operación protegida de reserva, visita o financiamiento aceptado conserva su propia pregunta y no autoriza captura de residencia. Estos límites de presentación no sustituyen los requisitos de un trámite financiero expresamente aceptado.
- full_name solo se conoce si su procedencia está confirmada en el perfil. Un nombre visible en WhatsApp/CRM no acredita identidad. Si la decisión autoriza pedir full_name, pida el nombre y no personalice con un alias. El revisor comprueba que se piden únicamente los datos autorizados, no se repiten los confirmados y se explica para qué se solicitan, sin comparar palabras ni frases con una plantilla.
- declared_location conserva el lugar declarado; residence_candidate es una posibilidad pendiente, NO residencia confirmada. Con question_purpose=confirm_residence reconozca el lugar candidato y pregunte si es su residencia actual, sin pedir nuevamente una ciudad desde cero. «Soy de X» merece esta aclaración aunque responda a una pregunta de residencia. Si ya hay residencia confirmada en profile_state, no vuelva a preguntarla. Una ciudad de origen distinta puede conservarse sin contradecir la residencia actual.
- Si name_acknowledgement tiene contenido, incluya «Mucho gusto, Nombre» usando ese nombre verificado, una sola vez. Es un reconocimiento del nombre recién declarado, no una cortesía opcional ni un saludo que deba suprimirse. No añada saludos adicionales.
- Si generic_introduction=true, presente brevemente La Vilet y su ubicación, y solicite los datos pendientes. Puede describir de forma breve el sector donde se ubica con información verificada; por ejemplo, que Puertas del Sol es una zona residencial describe la ubicación, no los tipos de inmuebles en venta. Todavía no presente los tipos de inmuebles que ofrece el proyecto, ni describa su combinación o usos residenciales/comerciales. La restricción es de significado: sustituir suites, departamentos, penthouses o locales por expresiones como «unidades residenciales y espacios comerciales» sigue adelantando las opciones. Esa presentación corresponde a la continuación después de los datos. No añada una segunda pregunta comercial. Las recomendaciones generales de explicar el concepto o la comodidad del proyecto no autorizan adelantar esta etapa.

- Si brochure_deferred=true, no adjunte todavía el brochure: se prometió para el siguiente intercambio. Si brochure_required=true, conserve el enlace verificado. Una petición directa del brochure se atiende sin exigir datos.
- Si question_purpose=confirm_residence y brochure_deferred=true, confirme primero si el lugar declarado es su residencia actual y deje el brochure para el siguiente intercambio. Si el brochure ya se compartió o se atiende una petición directa, no prometa enviarlo después de confirmar un dato ni presente la residencia como requisito para recibirlo: explique la pregunta por la guía personalizada. Si el lead no responde a la aclaración o rehúsa sus datos, continúe atendiendo su consulta sin reiterarla ni retener el material indefinidamente.
- Responder datos de perfil no inicia una visita, no autoriza financiamiento y no cambia las preferencias comerciales. No repita datos ya conocidos ni insista cuando no responde. La residencia no implica requisitos financieros, nacionalidad, elegibilidad ni disponibilidad distintos.
- No invente acabados, terrazas privadas para todas las unidades, superioridad de plusvalía ni visitas a obra. Mantenga la evidencia y los controles del proyecto.`

export function leadIntroductionIssues(reply: string, auditRaw: unknown) {
  const plan = object(object(auditRaw).profile_introduction)
  if (!Object.keys(plan).length) return []
  // Live semantic review owns meaning; URLs remain exact application identifiers.
  if (object(auditRaw).semantic_review_enabled === true) return [
    ...(plan.brochure_deferred === true && reply.includes(text(plan.brochure_url) || BROCHURE_URL) ? ['lead_profile_brochure_premature'] : []),
    ...(plan.brochure_required === true && !reply.includes(text(plan.brochure_url) || BROCHURE_URL) ? ['lead_profile_brochure_missing'] : []),
  ]
  const issues: string[] = []
  const value = normalized(reply), purpose = text(plan.question_purpose)
  // Presence is structural; the independent reviewer checks meaning, missing
  // fields and the brochure purpose. No vocabulary/phrase equivalence gate.
  if (['collect_profile', 'collect_name', 'collect_residence', 'confirm_residence'].includes(purpose)
    && !replyQuestions(reply).length) issues.push('lead_profile_question_missing')
  const acknowledgement = normalized(text(plan.name_acknowledgement))
  if (acknowledgement && !value.includes(acknowledgement)) issues.push('lead_profile_name_acknowledgement_missing')
  if (object(plan.profile_state).residence_status !== 'confirmed') {
    const statements = normalized(reply.replace(/¿[^¿?]*\?/g, ''))
    const candidate = object(plan.candidate || object(plan.profile_state).residence_candidate)
    const places = [text(candidate.city), text(candidate.country)].filter(Boolean)
    if (places.some(place => {
      const escaped = normalized(place).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`\\b(?:vive|reside|viviendo|su residencia (?:actual )?(?:es|esta))\\s+(?:actualmente\\s+)?(?:en\\s+)?${escaped}\\b`).test(statements)
    })) issues.push('lead_profile_unconfirmed_residence')
  }
  if (plan.generic_introduction === true && /\b(?:suites?|departamentos?|penthouses?|locales? comerciales?)\b/.test(normalized(reply))) issues.push('lead_profile_categories_premature')
  if (plan.brochure_deferred === true && reply.includes(text(plan.brochure_url) || BROCHURE_URL)) issues.push('lead_profile_brochure_premature')
  if (plan.brochure_required === true && !reply.includes(text(plan.brochure_url) || BROCHURE_URL)) issues.push('lead_profile_brochure_missing')
  return issues
}

/** A separate semantic decision keeps the stage rule visible to the reviewer.
 * The system resolves IDs against the actual draft; it does not guess synonyms.
 */
export function leadIntroductionReviewSchema(auditRaw: unknown, referencesRaw: unknown): { properties: Row; required: string[] } {
  if (object(object(auditRaw).profile_introduction).generic_introduction !== true) return { properties: {}, required: [] }
  const ids = rows(referencesRaw).map(row => text(row.id)).filter(Boolean)
  return { properties: { opening_property_type_sentence_ids: { type: 'array', maxItems: ids.length,
    description: 'CONTROL DE APERTURA ACTIVO. Seleccione los IDs de todas las oraciones que expliquen qué tipos de inmuebles ofrece el proyecto, también descripciones de usos residenciales/comerciales sin nombres de categorías. Presentar unidades residenciales y espacios comerciales sí cuenta. Ubicación, bienvenida y describir el sector como residencial no presentan tipos de inmuebles y no cuentan. Use [] únicamente si no presenta tipos. La veracidad de la oferta y pedir los datos después no eximen este control. Esta es la única salida para señalar tipos prematuros: no duplique ese motivo en operational_goal_preserved, review_issues o claims; el sistema aplicará la decisión comercial.',
    items: { type: 'string', ...(ids.length ? { enum: ids } : {}) } } }, required: ['opening_property_type_sentence_ids'] }
}

export function leadIntroductionReviewIssues(reviewRaw: unknown, auditRaw: unknown, referencesRaw: unknown): Row[] {
  if (object(object(auditRaw).profile_introduction).generic_introduction !== true) return []
  const ids = object(reviewRaw).opening_property_type_sentence_ids
  const references = new Map(rows(referencesRaw).map(row => [text(row.id), text(row.text)]))
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !references.has(id))) {
    return [{ code: 'invalid_opening_stage_review', kind: 'review_metadata', owner: 'system', repair_owner: 'reviewer',
      field: 'opening_property_type_sentence_ids',
      instruction: 'Revise la apertura del mismo borrador. Seleccione únicamente IDs de oraciones_borrador que introduzcan tipos de inmuebles o sus usos mediante nombres o paráfrasis; use [] si no hay ninguna. No reescriba el mensaje.' }]
  }
  return [...new Set(ids)].map(id => ({ code: 'lead_profile_categories_premature', kind: 'commercial_content',
    check: 'operational_goal_preserved', source: 'draft', sentence_id: id, fragment: references.get(id),
    owner: 'reviewer', validation_owner: 'system', repair_owner: 'writer',
    reason: 'La oración presenta tipos de inmuebles antes de la etapa prevista para ofrecer opciones.',
    instruction: 'Retire la presentación de tipos de inmuebles, también sus paráfrasis. Conserve una presentación breve del proyecto y su ubicación, y la pregunta de los datos pendientes.' }))
}

/** Concrete instructions for a commercial repair, separate from metadata repair. */
export function leadIntroductionRepairs(issues: string[], auditRaw: unknown): Row[] {
  const plan = object(object(auditRaw).profile_introduction)
  if (!Object.keys(plan).length) return []
  const instructions: Record<string, string> = {
    lead_profile_categories_premature: 'Elimine la enumeración y cualquier presentación de tipos de inmuebles de esta apertura, también si usa sinónimos o describe sus usos. No basta con cambiar suites, departamentos, penthouses y locales por «unidades residenciales y espacios comerciales». Presente brevemente el proyecto y su ubicación; conserve la pregunta de los datos pendientes. La presentación de opciones corresponde al siguiente intercambio.',
    lead_profile_question_missing: 'Incluya la pregunta de perfil exigida por la etapa, solicitando solamente los datos pendientes y explicando el propósito de brochure y guía personalizada. Para confirm_residence confirme el lugar candidato, sin pedir otra ciudad desde cero.',
    lead_profile_question_not_authorized: 'Retire la solicitud o confirmación de datos de presentación: su captura está pospuesta, rechazada o completa en profile_collection_decision. Conserve la respuesta a la consulta actual y continúe identificando las necesidades del lead según la decisión comercial vigente; no sustituya ese paso por nombre o residencia.',
    lead_profile_question_mismatch: 'Conserve la pregunta de perfil autorizada en profile_collection_decision.allowed_question_ids y solicite únicamente allowed_fields. No cambie la residencia pendiente por el nombre ya confirmado, ni aclare el origen si corresponde confirmar la residencia del candidato.',
    lead_profile_name_acknowledgement_missing: 'Incluya el reconocimiento name_acknowledgement del nombre declarado, una sola vez.',
    lead_profile_unconfirmed_residence: 'No afirme como residencia el lugar de origen o estancia temporal. Confirme si el candidato es su residencia actual.',
    lead_profile_brochure_premature: 'Retire el enlace del brochure: su entrega está prevista para el siguiente intercambio.',
    lead_profile_brochure_missing: 'Incluya el enlace verificado del brochure que corresponde entregar en este turno.',
  }
  return issues.filter(issue => instructions[issue]).map(issue => ({ code: issue, owner: 'system', repair_owner: 'writer',
    target: 'commercial_draft', instruction: instructions[issue], question_purpose: plan.question_purpose,
    missing_fields: plan.missing_fields || [], candidate: plan.candidate || null }))
}

// Legacy structured reviewer only; never part of writer instructions.
export const LEAD_INTRODUCTION_REVIEW_RULES = "- REVISOR: cuando generic_introduction=true, haga primero la comprobación de apertura. Lea cada oración de oraciones_borrador y pregúntese si explica qué tipos de espacios ofrece el proyecto al cliente. Si lo hace, seleccione su ID en opening_property_type_sentence_ids, aunque use una descripción general y no nombres de categorías. «Ofrecemos unidades residenciales modernas y espacios comerciales» SÍ presenta tipos; «La Vilet está en Puertas del Sol, Cuenca, un sector residencial consolidado» NO los presenta. Use [] solo si ninguna oración presenta esa oferta. Que los tipos sean reales, que la presentación sea breve o que después pida los datos no permite omitir sus IDs. Registre este hallazgo EXCLUSIVAMENTE en opening_property_type_sentence_ids: el sistema aplicará su efecto comercial. No duplique este motivo en operational_goal_preserved ni en review_issues, y no cambie claims a unsupported por estar fuera de etapa; revise su verdad factual por separado. operational_goal_preserved sigue comprobando los demás objetivos, como los datos pendientes o las acciones. Fuera de esta etapa no aplique la restricción de tipos."
