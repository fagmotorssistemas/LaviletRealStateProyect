import { ecuadorYmd } from '@/lib/inmobiliaria/agendaTime'
import { object,text,type Row } from './data'
import { turnCommunicationKind } from './turn-communication'

export const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
export function isGreetingOnly(message: string, interpretation: unknown = {}) {
  void message
  return turnCommunicationKind(interpretation) === 'greeting_only'
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

export function nextDiscoveryQuestion(lead: Row, currentPlan: Row = {}): { key: string; question: string; purpose: string } {
  void lead
  const question = text(currentPlan.question), key = text(currentPlan.question_id)
  if (!question || !key || currentPlan.continuation_optional === true) return { key: 'none', question: '', purpose: '' }
  return { key, question, purpose: text(currentPlan.instruction) }
}

export const reviewReasons = ['unsupported_fact', 'unsupported_action', 'ignored_question', 'repeated_greeting', 'repeated_question', 'style', 'missing_next_step'] as const
export const reviewSchema = { type: 'object', properties: { aprobada: { type: 'boolean' }, motivos: { type: 'array', items: { type: 'string', enum: reviewReasons } }, requiere_asesor: { type: 'boolean' } }, required: ['aprobada', 'motivos', 'requiere_asesor'], additionalProperties: false }
export function styleIssues(reply: string, alreadyWelcomed: boolean): string[] {
  void reply
  void alreadyWelcomed
  return []
}
