import { object, text, type Row } from './data'
import { isGreetingOnly, normalized } from './sdr-rules'
import { conversationalFirstName, isCourtesyOnly } from './conversation-style'
import { BROCHURE_URL } from './project-material'
import { mergeLeadProfile } from './lead-profile'
import { commercialContinuationSources } from './response-plan'

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
function greetingReplyOnly(content: string) {
  const value = normalized(content)
  return isGreetingOnly(content) || isCourtesyOnly(content)
    || /^(?:(?:hola|buenos dias|buenas tardes|buenas noches) )?(?:un gusto saludarle )?(?:en que|como) (?:podemos|puedo) ayudarle$/.test(value)
}
function hasEarlierConversation(history: unknown, current: string) {
  const messages = rows(history)
  // Some callers include the current inbound message at the end of their history.
  if (messages.at(-1)?.content === current && ['cliente', 'user'].includes(text(messages.at(-1)?.role))) messages.pop()
  return messages.filter(row => text(row.content).trim()).some(row => ['bot', 'asesor', 'assistant'].includes(text(row.role))
    ? !greetingReplyOnly(text(row.content))
    : ['cliente', 'user'].includes(text(row.role)) && !isGreetingOnly(text(row.content)) && !isCourtesyOnly(text(row.content)))
}
function withoutBrochure(reply: string, url: string) {
  return reply.split(/(?<=[.!?])\s+|\n+/).filter(sentence => !/brochure|folleto/i.test(sentence)
    && !sentence.includes(url) && !sentence.includes(BROCHURE_URL)).join(' ').trim()
}
function lastQuestion(reply: string) { return reply.match(/¿[^¿?]+\?\s*$/)?.[0].trim() || '' }
function withoutLastQuestion(reply: string) { return reply.replace(/\s*¿[^¿?]+\?\s*$/, '').trim() }
function generalInformation(current: string, audit: Row, extracted: Row) {
  return ['project_overview', 'project_information_choice'].includes(text(audit.source))
    || (object(extracted.turn_semantics).primary_intent === 'project_information'
      && !/precio|financ|credito|visita|dormitorio|ubicacion|direccion|entrega|construccion|departamento|suite|penthouse|local/.test(normalized(current)))
    || /^(?:(?:hola|buenos dias|buenas tardes|buenas noches|por favor|me gustaria|quiero|quisiera|necesito|deseo|mas|un poco de|de|del|sobre|el|la|vilet|proyecto)\s+)*(?:informacion|info|informes)(?:\s+(?:general|del|de|proyecto|la|vilet|por favor))*$/.test(normalized(current))
}
function explicitBrochure(current: string) {
  const value = normalized(current)
  return /brochure|brochur|folleto|\bpdf\b/.test(value) && !/\bno\b.{0,25}(?:quiero|necesito|envie|mande|brochure|folleto)/.test(value)
}
function concreteRequest(current: string) {
  return /precio|cuesta|cuestan|vale|valor|presupuesto|monto|dispongo|financ|credito|cuota|departamento|departmento|suite|penthouse|local|inver|vivir|dormitorio|habitacion|cuarto|visita|agend|reserv|ubicacion|direccion|constru|terminad|entrega|plano|modelo|recorrido|brochure|folleto|piscina|gimnasio|terraza|parqueader|area|metros|tamano|ampli|grande|espacio|opciones|informacion/.test(normalized(current))
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
  return mergeLeadProfile({ ...object(object(input.summary)._lead_profile), ...object(input.profile) }, object(object(input.extracted).lead_profile))
}

export function hasProfileAnswer(raw: unknown) {
  const profile = object(raw)
  return ['full_name', 'residence_city', 'residence_country'].some(key => text(profile[key]).trim())
    || Object.keys(object(profile.declared_location)).length > 0 || Object.keys(object(profile.residence_confirmation)).length > 0
}

function nameAcknowledgement(profile: Row, prior: Row) {
  const name = conversationalFirstName(text(profile.full_name))
  return name && normalized(name) !== normalized(text(prior.acknowledged_name))
    ? `Mucho gusto, ${name[0].toLocaleUpperCase('es') + name.slice(1)}.` : ''
}

function questionPurpose(missing: string[]) {
  return missing.length === 2 ? 'collect_profile' : missing[0] === 'full_name' ? 'collect_name' : 'collect_residence'
}

/** Persist the referent of the question actually sent, including paraphrases. */
export function leadProfilePendingQuestion(reply: string, auditRaw: unknown): Row {
  const plan = object(object(auditRaw).profile_introduction)
  const purpose = text(plan.question_purpose)
  if (!purpose || purpose === 'none' || leadIntroductionIssues(reply, auditRaw).some(issue => /question|confirmation/.test(issue))) return {}
  const question = reply.match(/¿[^¿?]+\?/g)?.at(-1) || ''
  if (!question) return {}
  const id = purpose === 'confirm_residence' ? 'lead_residence_confirmation'
    : purpose === 'collect_profile' ? 'lead_profile' : purpose === 'collect_name' ? 'lead_profile_name' : 'lead_profile_residence'
  return { id, act: 'profile', question, ...(purpose === 'confirm_residence' ? { residence_candidate: object(plan.candidate) } : {}) }
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
  const summary = object(input.summary), prior = object(summary._lead_introduction), audit = object(input.audit)
  const extracted = object(input.extracted), profile = knownProfile(input), missing = missingFields(profile)
  const unchanged = { reply: input.reply, state: prior, audit, applied: false, brochureDeferred: false }
  const currentProfile = object(extracted.lead_profile)
  const suppliedProfile = hasProfileAnswer(currentProfile)
  if (!input.current.trim() || (!suppliedProfile && (isGreetingOnly(input.current) || isCourtesyOnly(input.current)))) return unchanged
  const acknowledgement = nameAcknowledgement(profile, prior)
  const suppliedCandidate = Boolean(object(currentProfile.residence_candidate).city || object(currentProfile.residence_candidate).country)
    && profile.residence_status === 'pending_confirmation'
  const resumed = ['complete', 'skipped'].includes(text(prior.status)) && suppliedCandidate
  const acknowledgeOnly = () => {
    if (!acknowledgement || !text(currentProfile.full_name)) return unchanged
    return { ...unchanged, applied: true, reply: join(acknowledgement, input.reply),
      audit: { ...audit, profile_introduction: { profile_state: profile, question_purpose: 'none', name_acknowledgement: acknowledgement } } }
  }
  if (['complete', 'skipped'].includes(text(prior.status)) && !resumed) return acknowledgeOnly()
  const pending = prior.status === 'pending' || resumed, onlyProfile = pending && isProfileOnlyTurn(input.current, extracted)
  const excluded = !commercialContinuationSources.has(text(audit.source)) && !['', 'commercial', 'project_overview', 'project_information_choice', 'catalog_search', 'catalog_select',
    'catalog_reference', 'unit_price', 'location', 'unit_model_request', 'virtual_showroom', 'brochure', 'price_option_unavailable'].includes(text(audit.source))
  if ((excluded && !onlyProfile) || (!pending && hasEarlierConversation(input.history, input.current))) return acknowledgeOnly()
  const url = input.brochureUrl || BROCHURE_URL
  const category = categoryFor(input), overview = generalInformation(input.current, audit, extracted)
  if (!pending && !overview && !category && !concreteRequest(input.current) && !explicitBrochure(input.current)) return acknowledgeOnly()
  const base = withoutBrochure(input.reply, url)
  const deliver = pending || suppliedProfile || explicitBrochure(input.current) || missing.length === 0 || declinedProfile(input.current)
  const deliverBrochure = deliver && (prior.brochure_sent !== true || explicitBrochure(input.current))
  const brochure = deliverBrochure ? `Aquí tiene el brochure digital completo del proyecto: ${url}` : ''
  const candidate = object(profile.residence_candidate)
  const candidatePlace = [text(candidate.city), text(candidate.country)].filter(Boolean).join(', ')
  const needsConfirmation = profile.residence_status === 'pending_confirmation' && Boolean(candidatePlace)
  let question = '', purpose = 'none', result = '', reminderCount = Number(prior.reminder_count) || 0
  let state: Row
  if (!deliver) {
    question = profileQuestion(missing, false)
    purpose = questionPurpose(missing)
    result = join(overview ? PROJECT_INTRODUCTION : categoryIntroduction(input, category) || withoutLastQuestion(base), question)
    state = { version: 2, status: 'pending', reminder_count: 0, brochure_sent: false,
      category, continuation_reply: commercialContinuation(input, category, overview) }
  } else {
    const continuation = text(prior.continuation_reply) || commercialContinuation(input, category, overview)
    // Clarifying a supplied place is progress, not a second generic reminder.
    // Persist a separate limit so an evasive answer cannot cause an endless loop.
    const priorCandidate = object(prior.confirmation_candidate)
    const sameCandidate = normalized([text(priorCandidate.city), text(priorCandidate.country)].filter(Boolean).join(', ')) === normalized(candidatePlace)
    const confirm = needsConfirmation && suppliedProfile && !(prior.confirmation_asked === true && sameCandidate)
    const denial = object(currentProfile.residence_confirmation).decision === 'deny'
    const remind = !declinedProfile(input.current) && (confirm || onlyProfile && missing.length > 0 && (reminderCount < 1 || denial && prior.denial_followup_asked !== true))
    if (remind) {
      if (confirm) { question = `Entiendo que es de ${candidatePlace}. ¿Es también su lugar de residencia actual?`; purpose = 'confirm_residence' }
      else { question = profileQuestion(missing, true); purpose = questionPurpose(missing); reminderCount += 1 }
    }
    const contextual = onlyProfile ? '' : overview && !pending ? PROJECT_INTRODUCTION : base
    result = join(remind ? withoutLastQuestion(contextual) : contextual, brochure, remind ? question : onlyProfile || overview ? continuation : '')
    state = { ...prior, version: 2, status: remind ? 'pending' : 'complete', reminder_count: reminderCount,
      brochure_sent: true, category: text(prior.category) || category, continuation_reply: continuation,
      ...(confirm ? { confirmation_asked: true, confirmation_candidate: candidate } : {}),
      ...(denial && remind ? { denial_followup_asked: true } : {}) }
  }
  result = join(acknowledgement, result)
  const stage = !deliver ? 'request' : question ? 'reminder' : 'deliver'
  return { reply: result, state, applied: true, brochureDeferred: !deliver,
    audit: { ...audit, brochure_sent: deliverBrochure || prior.brochure_sent === true, profile_introduction: { stage, question, brochure_deferred: !deliver,
      brochure_required: deliverBrochure, brochure_url: url, generic_introduction: overview && !deliver,
      missing_fields: missing, reminder_count: reminderCount, residence_meaning: 'current_residence',
      profile_state: profile, question_purpose: purpose, candidate: needsConfirmation ? { ...candidate } : null,
      name_acknowledgement: acknowledgement || null,
      reason: needsConfirmation ? 'declared_place_requires_current_residence_confirmation' : pending ? 'continue_opening_profile_exchange' : 'first_substantive_project_contact' } } }
}

export const LEAD_INTRODUCTION_RULES = `
APERTURA Y PERFIL DEL LEAD
- Siga estado_operativo.profile_introduction y su profile_state compartido con el extractor. Primero responda la consulta concreta y después formule una sola pregunta con question_purpose. Puede reformularla conservando los datos faltantes y el propósito de brochure más guía personalizada; no se exige copiar toda la frase. La ubicación solicitada es dónde reside actualmente, nunca desde dónde escribe ni el lugar donde quiere comprar.
- declared_location conserva el lugar declarado; residence_candidate es una posibilidad pendiente, NO residencia confirmada. Con question_purpose=confirm_residence reconozca el lugar candidato y pregunte si es su residencia actual, sin pedir nuevamente una ciudad desde cero. «Soy de X» merece esta aclaración aunque responda a una pregunta de residencia. Si ya hay residencia confirmada en profile_state, no vuelva a preguntarla. Una ciudad de origen distinta puede conservarse sin contradecir la residencia actual.
- Si name_acknowledgement tiene contenido, incluya «Mucho gusto, Nombre» usando ese nombre verificado, una sola vez. Es un reconocimiento del nombre recién declarado, no una cortesía opcional ni un saludo que deba suprimirse. No añada saludos adicionales.
- Si generic_introduction=true, presente brevemente La Vilet y su ubicación sin enumerar suites, departamentos, penthouses ni locales. Esa presentación de opciones corresponde a la continuación después de los datos. No añada una segunda pregunta comercial.
- Si brochure_deferred=true, no adjunte todavía el brochure: se prometió para el siguiente intercambio. Si brochure_required=true, conserve el enlace verificado. Una petición directa del brochure se atiende sin exigir datos.
- Responder datos de perfil no inicia una visita, no autoriza financiamiento y no cambia las preferencias comerciales. No repita datos ya conocidos ni insista cuando no responde. La residencia no implica requisitos financieros, nacionalidad, elegibilidad ni disponibilidad distintos.
- No invente acabados, terrazas privadas para todas las unidades, superioridad de plusvalía ni visitas a obra. Mantenga la evidencia y los controles del proyecto.`

export function leadIntroductionIssues(reply: string, auditRaw: unknown) {
  const plan = object(object(auditRaw).profile_introduction)
  if (!Object.keys(plan).length) return []
  const issues: string[] = [], question = text(plan.question)
  const value = normalized(reply), purpose = text(plan.question_purpose)
  const questions = [...reply.matchAll(/¿([^¿?]+)\?/g)].map(match => normalized(match[1]))
  const asksName = questions.some(q => /nombre|como (?:se llama|le llam)/.test(q))
  const asksResidence = questions.some(q => /resid|\bviv[ea]|viviendo/.test(q))
  if (question && !purpose && !reply.includes(question)) issues.push('lead_profile_question_changed') // Historical audit compatibility.
  if (purpose === 'confirm_residence') {
    const candidate = object(plan.candidate)
    const placeMentioned = [text(candidate.city), text(candidate.country)].filter(Boolean).every(place => value.includes(normalized(place)))
    if (!asksResidence || !placeMentioned) issues.push('lead_profile_confirmation_omitted')
    else if (questions.some(q => /(?:en que|que|cual) (?:ciudad|pais|lugar)|donde (?:reside|vive)/.test(q))) issues.push('lead_profile_question_purpose_changed')
  } else if (['collect_profile', 'collect_name', 'collect_residence'].includes(purpose)) {
    if ((purpose !== 'collect_residence' && !asksName) || (purpose !== 'collect_name' && !asksResidence)) issues.push('lead_profile_question_purpose_changed')
    if (!/brochure|folleto/.test(value) || !/guia personalizada|orienta\w* (?:de forma )?personalizada/.test(value)) issues.push('lead_profile_question_purpose_changed')
  }
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
