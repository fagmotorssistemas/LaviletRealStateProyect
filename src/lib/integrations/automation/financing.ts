import { acceptedExtractorConfidence } from './extractor-confidence'
import { readCommercialContext } from './context-read'
import { db, object, scope, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isConversationRepair, explicitlyRequestsVisit } from './turn-routing'
import { hasFinancingRequest } from './financing-guidance'
import { financingQuoteInquiry } from './financing-quote'
import { operationalFinancingInvitation } from './financing-invitation'

export const FINANCING_PARTNER_CHOICE_SCHEMA = { type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', enum: ['select', 'decline', 'none'] }, name: { type: ['string', 'null'] },
    evidence: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['kind', 'name', 'evidence', 'confidence'] }
export const FINANCING_PARTNER_CHOICE_RULES = 'financing_partner_choice distingue elegir una entidad (select), rechazarla (decline) y mencionar/preguntar por ella (none). Nombre y evidencia literal ACTUAL; no arrastre la entidad del historial. Resuelva contrastes y cambios de preferencia. Un sí solo elige entidad si responde a una oferta inequívoca de una entidad concreta. La elección se conserva aunque falte unidad o perfil, pero no otorga consentimiento financiero.'

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

/** A budget worry deserves guidance, but does not authorize a credit application. */
export function hasAffordabilityConcern(current: string) {
  const message = normalized(current)
  return /\bno (?:se|estoy segur[oa]) (?:si|de que) (?:me |nos )?(?:alcanz\w*|pued\w* (?:compr\w*|pag\w*|adquir\w*))\b/.test(message)
    || /\b(?:no|apenas) (?:me|nos) alcanza\b|\b(?:no puedo|no podemos) (?:comprarlo|comprarla|pagarlo|pagarla|costearlo|costearla)\b/.test(message)
    || /\b(?:se (?:me|nos) (?:sale|va) (?:del|de) presupuesto|fuera de (?:mi|nuestro) presupuesto|no (?:tengo|tenemos) (?:el dinero|dinero suficiente|suficiente dinero))\b/.test(message)
    || /\b(?:se (?:me |nos )?(?:sale|va) de (?:mi|nuestro|el) presupuesto|(?:supera|sobrepasa) (?:mi|nuestro|el) presupuesto)\b/.test(message)
    || /\bno (?:tengo|tenemos) suficiente(?: dinero| presupuesto| capital| ahorro)?(?:$| para (?:compr\w*|pag\w*|adquir\w*|la compra)\b)/.test(message)
    || /(?<!no )\b(?:me parece|nos parece|se me hace|es|esta|son|estan) (?:muy |demasiado |bastante )?car[oa]s?\b/.test(message)
}

export function financingInputs(extracted: Row, current: string, lastReply: string, context: Awaited<ReturnType<typeof financingContext>>, lastStep: Row = {}) {
  let message = normalized(current)
  const semantics = object(extracted.turn_semantics)
  const choice = object(extracted.financing_partner_choice)
  const jep = context.partners.find(name => /^(?:cooperativa )?jep$/.test(normalized(name)))
  const contextualJepTypo = !!jep && /\bgep\b/.test(message)
    && (/\bcooperativa gep\b/.test(message) || /\bjep\b/.test(normalized(text(context.current.selected_partner_name)))
      || choice.kind === 'select' && /\bjep\b/.test(normalized(text(choice.name))))
  if (contextualJepTypo) message = message.replace(/\bgep\b/g, 'jep')
  const pendingAnswer = object(object(extracted.turn_semantics).answer_to_previous)
  const literal = (value: unknown) => !!text(value).trim() && normalized(current).includes(normalized(text(value)))
  const currentFinancialRequest = hasFinancingRequest(extracted) && (
    semantics.primary_intent === 'ask_financing' && literal(semantics.primary_evidence)
    || Array.isArray(semantics.requests) && semantics.requests.map(object)
      .some(request => request.domain === 'financing' && acceptedExtractorConfidence(request.confidence) && literal(request.evidence)))
  const otherQuestion = acceptedExtractorConfidence(pendingAnswer.confidence) && !!pendingAnswer.question_id
    && !['none', 'financing_invitation'].includes(text(pendingAnswer.question_id))
    || lastStep.kind === 'commercial_question' && lastStep.reply === lastReply
  const asksConsent = !otherQuestion && lastStep.kind === 'financing_consent'
    && lastStep.reply === lastReply && operationalFinancingInvitation(lastStep.invitation)
  const decision = message.split(/\n+|\s+y\s+(?=(?:el local|la vivienda|el departamento|cuanto|que|como|eso)\b)/)[0]
  const answerEvidence = text(pendingAnswer.evidence).trim()
  const currentAnswer = !!answerEvidence && normalized(current).includes(normalized(answerEvidence))
  const groundedInvitation = asksConsent && pendingAnswer.question_id === 'financing_invitation'
    && acceptedExtractorConfidence(pendingAnswer.confidence) && currentAnswer
  const semanticAcceptance = extracted.financing_consent !== false && groundedInvitation && pendingAnswer.kind === 'affirmative'
  const currentConsent = extracted.financing_consent === true && currentFinancialRequest
  const conditional = /\b(?:solo si|siempre que|a condicion|si me (?:aprueban|aseguran|garantizan))\b/.test(message)
    || /\b(?:credito directo|otra entidad)\b/.test(decision)
    || /\bpero\b/.test(decision) && !semanticAcceptance && !currentConsent
  const choiceEvidence = text(choice.evidence).trim()
  const groundedChoice = acceptedExtractorConfidence(choice.confidence) && !!choiceEvidence && choiceEvidence.length <= 500
    && normalized(current).includes(normalized(choiceEvidence))
  const declined = groundedInvitation && pendingAnswer.kind === 'negative'
    || /^(?:no|ahora no|por ahora no|todavia no|mejor no)\b|\bno (?:quiero|deseo|autorizo|me interesa)\b/.test(message)
      && !(groundedChoice && ['select', 'decline'].includes(text(choice.kind)))
  const explicitFinancialDecline = /\bno (?:quiero|deseo|autorizo|necesito|me interesa)\b[^.!?]{0,55}\b(?:financiamiento|credito|revision financiera|evaluacion financiera|precalificacion)\b/.test(message)
    || /\b(?:cancelar|cancele|cancelen|cancelamos|detener|detenga)\b[^.!?]{0,55}\b(?:financiamiento|credito|revision financiera|evaluacion financiera|precalificacion)\b/.test(message)
  // A new authorization belongs to the current AI interpretation. Keywords in
  // a status inquiry cannot start another review, and choosing a lender alone
  // is not consent. A grounded answer can accept the delivered typed invitation
  // without depending on either model's particular wording.
  const inquiry = financingQuoteInquiry(extracted, current)
  const consent = inquiry.beforeApplication || conditional || declined || explicitFinancialDecline ? null
    : semanticAcceptance || currentConsent ? true : null
  let partner = text(extracted.financing_partner)
  if (contextualJepTypo && /^(?:cooperativa )?gep$/.test(normalized(partner))) partner = jep || ''
  // The extractor can carry an old lender forward; only accept a choice mentioned now.
  if (partner && !normalized(current).includes(normalized(partner.replace(/^(banco|cooperativa)\s+/i, '')))) partner = ''
  if (/jardin\s*(?:azuayo|zauayo)/.test(message)) partner = 'Jardín Azuayo'
  const alias = (name: string) => normalized(name.replace(/^(banco|cooperativa)\s+/i, ''))
  const known = context.partners.find(name => normalized(partner) === normalized(name) || normalized(partner) === alias(name))
  if (known) partner = known
  else if (!partner) {
    const mentions = context.partners.filter(name => (` ${message} `).includes(` ${alias(name)} `))
    // Preserve the extractor's choice for contrasts such as «Pichincha no, prefiero JEP».
    if (mentions.length === 1 && !/\bno\b/.test(message)) partner = mentions[0]
  }
  let unsupported = partner && !context.partners.some(name => normalized(name) === normalized(partner)) ? partner : ''
  // Asking what a lender offers is not a new choice; keep any saved choice intact.
  if (inquiry.beforeApplication && !/\b(?:prefiero|elijo|escojo|me quedo con|continuemos con)\b/.test(message)) partner = ''
  let clearedPartner = ''
  if (Object.hasOwn(extracted, 'financing_partner_choice')) {
    const canonical = context.partners.find(name => normalized(text(choice.name)) === normalized(name)
      || normalized(text(choice.name)) === alias(name))
    const mentionedNow = canonical && (normalized(choiceEvidence).includes(alias(canonical)) || contextualJepTypo && canonical === jep)
    const acceptsOnlyEntity = pendingAnswer.question_id === 'financing_partner' && acceptedExtractorConfidence(pendingAnswer.confidence)
      && pendingAnswer.kind === 'affirmative' && currentAnswer && context.partners.length === 1
      && canonical === context.partners[0]
    partner = groundedChoice && canonical && (mentionedNow || acceptsOnlyEntity) && choice.kind === 'select' ? canonical : ''
    clearedPartner = groundedChoice && canonical && mentionedNow && choice.kind === 'decline' ? canonical : ''
    unsupported = groundedChoice && choice.kind === 'select' && !canonical ? text(choice.name) : ''
  } else if ((/[¿?]/.test(current) || /\b(?:que ofrece|que requisitos|como funciona|cuales son|que condiciones)\b/.test(message))
    && !/\b(?:prefiero|elijo|escojo|me quedo con|continuemos con)\b/.test(message)) partner = ''
  return { consent, partner: unsupported ? null : partner || null, unsupported: inquiry.beforeApplication ? '' : unsupported,
    partner_evidence: partner ? groundedChoice ? choiceEvidence : current : '', cleared_partner: clearedPartner || null,
    ...(declined && asksConsent || explicitFinancialDecline ? { declined: true } : {}) }
}

/** A grounded answer supplying a lender is intake data, not a new question
 * about financing. Consent and property prerequisites are checked by the caller. */
export function financingPartnerAnswer(extracted: Row, input: { partner?: string | null }) {
  const semantics = object(extracted.turn_semantics), answer = object(semantics.answer_to_previous)
  const evidence = text(answer.evidence), message = normalized(evidence)
  const explicitChoice = /\b(?:prefiero|elijo|escojo|me quedo con|continuemos con)\b/.test(message)
  const informationQuestion = /[¿?]/.test(evidence) || /\b(?:que ofrece|que requisitos|como funciona|cuales son|que condiciones)\b/.test(message)
  // answer_to_previous is already bound to the actual pending question by the
  // interpreter. A broad ask_financing label must not discard a lender choice.
  return !!input.partner && answer.question_id === 'financing_partner'
    && acceptedExtractorConfidence(answer.confidence) && answer.kind === 'value'
    && (!informationQuestion || explicitChoice)
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
    question: (reply.match(/¿[^¿?]+\?\s*$/)?.[0] || reply).trim().slice(0, 500), target_ids: [], candidate_ids: [] }
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
  const message = normalized(current)
  if (extracted.requested_advisor || extracted.opt_out) return false
  if (isConversationRepair(current) || explicitlyRequestsVisit(current)) return false
  if (/\b(?:cita|visita|cancelar|reagendar)\b/.test(message)) return false
  if (hasFinancingRequest(extracted)) return true
  if (/financ|credito|entidad|banco|cooperativa|pichincha|\bjep\b|jardin azuayo/.test(message) || input.partner || input.unsupported) return true
  if (/[?¿]/.test(current)) return false // A question deserves an answer, not the next form field.
  const answer = object(object(extracted.turn_semantics).answer_to_previous)
  return ['financing_invitation', 'financing_partner', 'financing_data', 'financing_down_payment'].includes(text(answer.question_id))
    && acceptedExtractorConfidence(answer.confidence) && ['affirmative', 'value'].includes(text(answer.kind))
    || ['national_id', 'applicant_type', 'employment_stability_months', 'job_title', 'monthly_income', 'ruc']
      .some(key => extracted[key] != null)
}

export function financingQuestionReply(current: string, partners: string[], _lastReply = '', extracted: Row = {}) {
  void _lastReply // References are interpreted upstream, not read from writer prose.
  const m = normalized(current)
  if (financingQuoteInquiry(extracted, current).requested) return 'Con mucho gusto le orientamos sobre la entrada y las cuotas. La entrada del proyecto y la aportación propia para el crédito se revisan por separado; las cifras disponibles se basan en las condiciones vigentes de cada entidad y la unidad de interés. Una orientación no inicia una solicitud ni confirma la aprobación.'
  // The interpreted request resolves elliptical references such as «esas dos».
  // A previous writer sentence cannot classify a new customer request.
  const financialSubject = /financ|credito|prestamo|entidad|banco|cooperativa|pichincha|\bjep\b|jardin azuayo/.test(m)
    || hasFinancingRequest(extracted)
  if (/aprob|garanti|asegur/.test(m) && /credito|financ|prestamo/.test(m)) {
    return 'Le acompañamos en el proceso, pero no podemos asegurar la aprobación del crédito. La entidad necesita revisar su caso para confirmarla.'
  }
  const asksReviewDetails = /\b(?:requisitos|elegible|elegibilidad|califico|calificar)\b|\bque (?:necesito|necesita|necesitamos|piden|solicitan)\b|\bcomo (?:funciona|es|se hace|puedo saber)\b/.test(m)
    && /credito|financ|prestamo|elegib/.test(m)
  const reviewDetails = 'Podemos explicarle y acompañarle en una revisión preliminar por este chat. Después de aceptar continuar, consultamos cuánto tendría disponible para la entrada si todavía falta ese dato y después definimos la unidad de su interés, conservando una unidad ya elegida. Si aún no define la entrada, podemos seguir orientándole. Elegimos una entidad únicamente si todavía no la indicó y después solicitamos nombres completos, número de cédula y si trabaja como dependiente o independiente. Luego se solicitan los datos laborales e ingresos correspondientes a su situación. El equipo interno revisará su caso y la entidad confirmará sus requisitos y condiciones.'
  if (/credito directo|financi(?:amiento|ar).*direct|directamente con (?:ustedes|el proyecto)/.test(m)) {
    return `No ofrecemos crédito directo con el proyecto.${partners.length ? ' Podemos ayudarle a explorar un crédito con ' + partners.join(' o ') + '.' : ' Podemos revisar con el equipo qué alternativas bancarias hay.'}${asksReviewDetails ? ' ' + reviewDetails : ''}`
  }
  if (financialSubject && /solo.*(?:esas|estas|dos|entidades)|(?:otra|otras).*entidad/.test(m)
    && !/jardin|pichincha|\bjep\b/.test(m)) {
    return partners.length ? `Trabajamos con ${partners.join(' y ')}. ¿Tiene otra entidad en mente?`
      : 'El equipo puede ayudarle a comprobar las opciones vigentes. ¿Con qué entidad le gustaría financiarse?'
  }
  if (asksReviewDetails || hasFinancingRequest(extracted)) return partners.length
    ? `Podemos explorar opciones con ${partners.join(' o ')}. ${reviewDetails}`
    : 'Todavía no hay una entidad confirmada para iniciar la revisión. Podemos explicar el proceso preliminar, pero las alternativas y los requisitos aplicables deben confirmarse antes de solicitar datos.'
  return ''
}

export function avoidFinancingRepeat(reply: string, current: string, lastReply: string, fin: Row, partners: string[]) {
  if (normalized(reply) !== normalized(lastReply)) return reply
  if (/repite|repita|otra vez|no entendi/.test(normalized(current))) return reply
  if (text(fin.state) === 'continuacion_pendiente') return partners.length
    ? `La revisión sería con ${partners.join(' o ')} y requiere su autorización para solicitar algunos datos. ¿Desea iniciar esa revisión?`
    : 'Todavía falta que el equipo confirme las alternativas disponibles. Podemos seguir resolviendo sus dudas sobre la compra.'
  if (text(fin.state) === 'entidad_pendiente') return partners.length
    ? `Para continuar falta elegir la entidad: ${partners.join(' o ')}. ¿Cuál prefiere?`
    : 'Aún no tengo una entidad confirmada para ofrecerle. El equipo debe comprobarlo antes de pedirle datos para una revisión.'
  return 'Ese dato todavía no quedó claro. Puede escribirlo de otra forma o indicarme si prefiere continuar la revisión con una persona.'
}

// A combined price/financing question needs information, not an application.
export function priceFinancingReply(current: string, context: Awaited<ReturnType<typeof financingContext>>) {
  if (/\b(?:no (?:quiero|necesito|deseo|me interesa)|sin)\b.*\b(?:financiamiento|credito)\b/.test(normalized(current))) return ''
  const question = financingQuestionReply(current, context.partners)
  if (question) return question.replace(/\s*¿[^?]+\?\s*$/, '')
  const choice = financingInputs({}, current, '', context)
  if (choice.unsupported) return financingReply({}, context.partners, choice.unsupported).replace(/\s*¿[^?]+\?\s*$/, '')
  if (choice.partner) return `Podemos revisar el financiamiento con ${choice.partner} y acompañarle en el proceso.`
  return financingReply({ state: 'continuacion_pendiente' }, context.partners).replace(/\s*¿[^?]+\?\s*$/, '')
}
