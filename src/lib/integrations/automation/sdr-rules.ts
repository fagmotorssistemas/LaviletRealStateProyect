import { object, text, type Row } from './data'
import { ecuadorYmd } from '@/lib/inmobiliaria/agendaTime'

export const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
export function isGreetingOnly(message: string) {
  return !normalized(message) || /^(hola|buenos dias|buenas tardes|buenas noches|buen dia|buenas|hola buenos dias|hola buenas tardes|hola buenas noches)$/.test(normalized(message))
}

export function sdrState(lead: Row, history: unknown, excludedIds: string[] = []) {
  const rows = (Array.isArray(history) ? history : []).map(object).filter(r => !excludedIds.includes(text(r.id)))
  const replies = rows.filter(r => ['bot', 'asesor'].includes(text(r.role)))
  const lastReply = text(replies[replies.length - 1]?.content)
  const sdr = object(object(lead.behavior_signals).sdr)
  const lastAt = Math.max(0, Date.parse(text(lead.last_bot_message_at)) || 0, ...replies.map(r => Date.parse(text(r.sent_at)) || 0))
  const now = new Date()
  const activeSession = lastAt > 0 && ecuadorYmd(new Date(lastAt)) === ecuadorYmd(now) && now.getTime() - lastAt < 15 * 60_000
  return { ya_saludamos: activeSession, ultima_respuesta: lastReply,
    datos_conocidos: { categoria: lead.preferred_category || null, proposito: lead.purchase_purpose || null,
      dormitorios: lead.preferred_bedrooms || null, presupuesto: lead.budget_max || lead.budget || null, ...sdr } }
}

// Text evidence is kept verbatim; previous facts cannot be extracted again from a bot's question.
export function qualifiedFacts(raw: Row, message: string): Row {
  const facts: Row = {}
  for (const key of ['actividad_comercial', 'area_buscada', 'prioridad', 'plazo_compra', 'presupuesto_texto', 'dormitorios_texto']) {
    const value = text(raw[key]).trim()
    if (value && value.length <= 180 && normalized(message).includes(normalized(value))) facts[key] = value
  }
  return facts
}

export function nextDiscoveryQuestion(lead: Row): { key: string; question: string } {
  const sdr = object(object(lead.behavior_signals).sdr), category = text(lead.preferred_category)
  if (!category) return { key: 'categoria', question: '¿Está buscando una vivienda o un local para su negocio?' }
  if (!lead.purchase_purpose) return { key: 'proposito', question: category === 'local'
    ? '¿Lo busca para su propio negocio o para invertir y arrendarlo?'
    : '¿Lo busca para vivir o como inversión?' }
  if (category === 'local') {
    if (lead.purchase_purpose === 'negocio' && !sdr.actividad_comercial) return { key: 'actividad_comercial', question: '¿Qué tipo de negocio le gustaría instalar?' }
    if (!sdr.prioridad) return { key: 'prioridad', question: '¿Qué sería lo más importante para usted al elegir el local?' }
  } else {
    if (category === 'departamento' && !lead.preferred_bedrooms && !sdr.dormitorios_texto) return { key: 'dormitorios', question: '¿Cuántos dormitorios necesita?' }
    if (!sdr.prioridad) return { key: 'prioridad', question: lead.purchase_purpose === 'invertir'
      ? '¿Qué le gustaría priorizar en su inversión?'
      : '¿Qué le gustaría mejorar en su día a día con su nueva vivienda?' }
  }
  if (!lead.budget && !lead.budget_max && !sdr.presupuesto_texto) return { key: 'presupuesto', question: '¿Tiene un presupuesto aproximado en mente para orientar la búsqueda?' }
  if (!sdr.plazo_compra) return { key: 'plazo_compra', question: '¿Para cuándo le gustaría tomar una decisión de compra?' }
  return { key: 'visita', question: '¿Le gustaría coordinar una visita para conocer mejor las opciones?' }
}

export const reviewReasons = ['unsupported_fact', 'unsupported_action', 'ignored_question', 'repeated_greeting', 'repeated_question', 'style', 'missing_next_step'] as const
export const reviewSchema = { type: 'object', properties: { aprobada: { type: 'boolean' }, motivos: { type: 'array', items: { type: 'string', enum: reviewReasons } } }, required: ['aprobada', 'motivos'], additionalProperties: false }
export function styleIssues(reply: string, alreadyWelcomed: boolean): string[] {
  const issues: string[] = []
  if (/no todos(?: los (?:departamentos|inmuebles|locales|espacios))? (?:tienen|cuentan|incluyen)|(?:el|la) (?:unidad )?\d+ no (?:lo )?(?:incluye|tiene|cuenta)|otros como (?:el|la) \d+ no/i.test(reply)) issues.push('unsupported_fact')
  if (alreadyWelcomed && /^(hola\b|buenos d[ií]as\b|buenas (tardes|noches)\b|bienvenid[oa]\b)/i.test(reply.trim())) issues.push('repeated_greeting')
  if ((reply.match(/\?/g) || []).length > 1 || /\p{Extended_Pictographic}/u.test(reply)
    || /soy (?:su|tu|el|la) asesor|mi nombre es/i.test(reply)
    || /amenidades|gracias por (?:compartir|comentarlo|aclararlo)|entiendo que busca|as[ií] podr[eé] orientarle|acompa[nñ]arle en el proceso/i.test(reply)
    || (reply.match(/la\s*vilet/gi) || []).length > 1) issues.push('style')
  return issues
}
