import { LATER_ROUTES, type LaterWeek } from '@/lib/inmobiliaria/nutritionLater'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { nutritionIntent } from './nutrition-intent'

export function laterChoice(week: LaterWeek, lead: Row, _history: Row[], outbound: Row[], partners: string[], summary: Row = {}) {
  const intent = nutritionIntent(lead, summary)
  // These approved templates invite a purchase decision. They cannot be
  // rewritten into informational templates, so keep them paused in that mode.
  if (intent.informational) return null
  const purpose = intent.purchasePurpose, category = intent.category
  let topic = '', action = ''
  if (week === 2) {
    topic = purpose === 'invertir' ? 'una propiedad para invertir' : category === 'local' ? purpose === 'negocio' ? 'un local para su negocio' : 'un local comercial'
      : purpose === 'vivir' ? 'un nuevo hogar' : 'el espacio adecuado para usted'
    action = 'invite_pending_questions'
  } else {
    const actions = outbound.flatMap(m => Object.values(object(m.tool_calls)).map(v => text(object(v).action)))
    const candidates: { action: string; topic: string }[] = []
    if (partners.length && intent.financing) candidates.push({ action: 'financing_options', topic: 'conocer las alternativas de financiamiento' })
    if (category || lead.unit_id || purpose) candidates.push({ action: 'purchase_process', topic: 'revisar el proceso de compra del inmueble que le interesa' })
    candidates.push({ action: 'advisor_conversation', topic: 'coordinar una conversación con un asesor' })
    const selected = candidates.find(c => !actions.includes(c.action))
    if (!selected) return null
    action = selected.action
    topic = selected.topic
  }
  const route = LATER_ROUTES[week]
  return { action, topic, body: route.body.replace('{{1}}', topic), reason: week === 2 ? 'purpose_based_question_invitation' : 'relevant_next_step_not_previously_offered' }
}

export function laterContinuation(current: string, history: unknown) {
  const rows = (Array.isArray(history) ? history : []).map(object)
  const last = rows.findLast(m => ['bot', 'asesor'].includes(text(m.role)))
  if (!last || last.role !== 'bot') return null
  const answer = normalized(current).replace(/^(?:hola|saludos|buenas)\s+/, '')
  if (!/^(?:si(?: claro| por favor| gracias| me interesa| quiero| me gustaria)?|claro(?: que si)?|por supuesto|de acuerdo|ok|esta bien|perfecto|adelante|me interesa|hagamoslo|continuemos|me gustaria)$/.test(answer)) return null
  for (const week of [2, 3] as const) {
    const [before, after] = LATER_ROUTES[week].body.split('{{1}}'), body = text(last.content).trim()
    if (!body.startsWith(before) || !body.endsWith(after)) continue
    const topic = body.slice(before.length, -after.length)
    const messages: Record<string, string> = week === 2 ? {
      'un nuevo hogar': 'Quisiera aclarar una duda sobre la vivienda que me interesa.',
      'un local para su negocio': 'Quisiera aclarar una duda sobre el local que me interesa.',
      'un local comercial': 'Quisiera aclarar una duda sobre el local que me interesa.',
      'una propiedad para invertir': 'Quisiera aclarar una duda sobre la propiedad para invertir que me interesa.',
      'el espacio adecuado para usted': 'Quisiera aclarar una duda sobre el proyecto.',
    } : {
      'conocer las alternativas de financiamiento': 'Quiero información sobre las opciones de financiamiento disponibles.',
      'revisar el proceso de compra del inmueble que le interesa': '¿Cómo es el proceso de compra de un inmueble en La Vilet?',
      'coordinar una conversación con un asesor': 'Quiero hablar con un asesor.',
    }
    if (messages[topic]) return { original: current, topic, message: messages[topic], sourceMessageId: text(last.id) }
  }
  return null
}
