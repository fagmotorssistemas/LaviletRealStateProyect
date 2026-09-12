import { db, object, scope, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isConversationRepair, explicitlyRequestsVisit } from './turn-routing'

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

export function financingInputs(extracted: Row, current: string, lastReply: string, context: Awaited<ReturnType<typeof financingContext>>) {
  const message = normalized(current)
  const asksConsent = /revision|financiamiento|revisar esa opcion/.test(normalized(lastReply)) && /desea continuar|iniciar|iniciemos|revisemos|revisar esa opcion|revision.*\?/.test(lastReply.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
  const conditional = /\b(?:pero|solo|siempre que|credito directo|otra entidad)\b/.test(message) || /[?¿]/.test(current)
  const consent = asksConsent && /^(si|si claro|claro|si por favor|de acuerdo|continuemos|si continuemos)$/.test(message)
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
    ? `Por el momento no tenemos una alianza registrada con ${unsupported}. Podemos acompañarle con ${options}; la aprobación depende de la entidad. ¿Le gustaría revisar esa opción?`
    : `No tenemos una alianza registrada con ${unsupported}. Podemos consultar con el equipo las opciones de financiamiento vigentes. ¿Le gustaría que le ayuden?`
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
      ? `Sí, podemos orientarle sobre financiamiento con ${options}. La entidad evalúa cada solicitud. ¿Le gustaría que iniciemos una revisión de su caso?`
      : 'Sí, podemos ayudarle a revisar las opciones de financiamiento. ¿Le gustaría que el equipo le oriente?',
  }
  const reply = messages[text(fin.state || fin.financing_state)]
  if (!reply) throw new Error('UNKNOWN_FINANCING_STATE')
  return reply
}

// An existing qualification is saved progress, not permission to monopolize every turn.
export function isFinancingTurn(extracted: Row, current: string, lastReply: string, input: { partner: string | null; unsupported: string }) {
  const message = normalized(current), previous = normalized(lastReply)
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
  if (/credito directo|financi(?:amiento|ar).*direct|directamente con (?:ustedes|el proyecto)/.test(m)
    || (/credito directo/.test(previous) && /pero|o no dan|quiero saber|dispongo|tengo|por que/.test(m))) {
    const amount = /(?:dispongo|tengo|cuento con).*\b150\b/.test(m)
      ? ' Cuando dice 150, ¿se refiere a $150 o a $150.000?' : ''
    return `No ofrecemos crédito directo con el proyecto.${partners.length ? ' Podemos orientarle con ' + partners.join(' o ') + '; la aprobación depende de la entidad.' : ' Podemos revisar con el equipo qué alternativas bancarias hay.'}${amount}`
  }
  if (/solo.*(?:esas|estas|dos|entidades)|(?:otra|otras).*entidad/.test(normalized(current)) && !/jardin|pichincha|\bjep\b/.test(normalized(current))) {
    return partners.length ? `Por ahora, las alianzas registradas son con ${partners.join(' y ')}. ¿Tiene otra entidad en mente?`
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
