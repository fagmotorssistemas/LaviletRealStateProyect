import { db, object, scope, text, type Row } from './data'
import { normalized } from './sdr-rules'

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
  const asksConsent = /revisi[oó]n|financiamiento/.test(lastReply) && /desea continuar|iniciar|iniciemos|revisemos|revisi[oó]n.*\?/.test(lastReply)
  const consent = asksConsent && /^(si|si claro|claro|si por favor|de acuerdo|continuemos|si continuemos)$/.test(message)
    ? true : extracted.financing_consent
  let partner = text(extracted.financing_partner)
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
    continuacion_pendiente: options
      ? `Sí, podemos orientarle sobre financiamiento con ${options}. La entidad evalúa cada solicitud. ¿Le gustaría que iniciemos una revisión de su caso?`
      : 'Sí, podemos ayudarle a revisar las opciones de financiamiento. ¿Le gustaría que el equipo le oriente?',
  }
  const reply = messages[text(fin.state || fin.financing_state)]
  if (!reply) throw new Error('UNKNOWN_FINANCING_STATE')
  return reply
}
