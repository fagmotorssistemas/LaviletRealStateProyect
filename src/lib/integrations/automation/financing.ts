import { db, object, scope, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isConversationRepair, explicitlyRequestsVisit } from './turn-routing'
import { acceptsUnitOptions } from './sales-policy'

export async function financingContext(lead: Row) {
  const [partners, qualification] = await Promise.all([
    db().from('project_financing_partners').select('public_enabled,test_only,test_phone,public_name,financing_options')
      .match(scope).eq('public_enabled', true),
    db().from('financing_prequalifications').select('explicit_consent,selected_partner_name,status')
      .match(scope).eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(1),
  ])
  if (partners.error || qualification.error) throw new Error('FINANCING_CONTEXT_FAILED')
  const digits = (value: unknown) => text(value).replace(/\D/g, '')
  const eligible = (partners.data ?? []).filter(p => p.test_only !== true || (digits(lead.phone) && digits(lead.phone) === digits(p.test_phone)))
  // Project agreements are authoritative; do not advertise entries from the global bank catalog.
  const names = [...new Set(eligible.flatMap(p => (Array.isArray(p.financing_options) ? p.financing_options : [])
    .map(option => text(object(option).name)).filter(Boolean)))]
  return { partners: names, current: object(qualification.data?.[0]) }
}

export function financingInputs(extracted: Row, current: string, lastReply: string, context: Awaited<ReturnType<typeof financingContext>>, lastStep: Row = {}) {
  const message = normalized(current)
  const verifiedConsentStep = lastStep.kind === 'financing_consent' && lastStep.reply === lastReply && /\?/.test(lastReply)
  const asksConsent = verifiedConsentStep || (/revision|financiamiento|revisar esa opcion/.test(normalized(lastReply)) && /desea continuar|iniciar|iniciemos|revisemos|revisar esa opcion|revision.*\?/.test(lastReply.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()))
  const conditional = /\b(?:pero|solo|siempre que|credito directo|otra entidad)\b/.test(message) || /[?¿]/.test(current)
  const consent = asksConsent && /^(si|si claro|claro|si por favor|de acuerdo|continuemos|si continuemos|por supuesto|si por supuesto|hagamoslo|me gustaria)$/.test(message)
    ? true : conditional ? null : asksConsent ? extracted.financing_consent : null
  let partner = text(extracted.financing_partner)
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
  if (context.current.explicit_consent === true && context.partners.length === 1
    && normalized(lastReply).includes(normalized(context.partners[0]))
    && /^(si|si claro|claro|si por favor|de acuerdo)$/.test(message)) partner = context.partners[0]
  const unsupported = partner && !context.partners.some(name => normalized(name) === normalized(partner)) ? partner : ''
  return { consent, partner: unsupported ? null : partner || null, unsupported }
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
    ingreso_pendiente: '¿Cuál es su ingreso mensual aproximado?', ruc_pendiente: '¿Me indica su número de RUC, por favor?',
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
export function isFinancingTurn(extracted: Row, current: string, lastReply: string, input: { partner: string | null; unsupported: string }) {
  const message = normalized(current), previous = normalized(lastReply)
  if (acceptsUnitOptions(current, lastReply)) return false
  if (isConversationRepair(current) || explicitlyRequestsVisit(current) || extracted.requested_advisor || extracted.opt_out) return false
  if (/\b(?:cita|visita|cancelar|reagendar)\b/.test(message)) return false
  if (/financ|credito|entidad|banco|cooperativa|pichincha|\bjep\b|jardin azuayo/.test(message) || input.partner || input.unsupported) return true
  if (!/financ|revision|entidad|cedula|ruc|ingreso mensual|cargo actual|empleo actual|relacion de dependencia|nombre completo/.test(previous)) return false
  if (/[?¿]/.test(current)) return false // A question deserves an answer, not the next form field.
  return extracted.financing_consent != null || ['full_name', 'national_id', 'applicant_type', 'employment_stability_months', 'job_title', 'monthly_income', 'ruc']
    .some(key => extracted[key] != null) || /^(si|si claro|claro|de acuerdo|si por favor)$/.test(message)
}

export function financingQuestionReply(current: string, partners: string[], lastReply = '') {
  const m = normalized(current), previous = normalized(lastReply)
  if (/aprob|garanti|asegur/.test(m) && /credito|financ|prestamo/.test(m)) {
    return 'Le acompañamos en el proceso, pero no podemos asegurar la aprobación del crédito. La entidad necesita revisar su caso para confirmarla.'
  }
  if (/credito directo|financi(?:amiento|ar).*direct|directamente con (?:ustedes|el proyecto)/.test(m)
    || (/credito directo/.test(previous) && /pero|o no dan|quiero saber|dispongo|tengo|por que/.test(m))) {
    return `No ofrecemos crédito directo con el proyecto.${partners.length ? ' Podemos ayudarle a explorar un crédito con ' + partners.join(' o ') + '.' : ' Podemos revisar con el equipo qué alternativas bancarias hay.'}`
  }
  if (/solo.*(?:esas|estas|dos|entidades)|(?:otra|otras).*entidad/.test(normalized(current)) && !/jardin|pichincha|\bjep\b/.test(normalized(current))) {
    return partners.length ? `Trabajamos con ${partners.join(' y ')}. ¿Tiene otra entidad en mente?`
      : 'El equipo puede ayudarle a comprobar las opciones vigentes. ¿Con qué entidad le gustaría financiarse?'
  }
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
