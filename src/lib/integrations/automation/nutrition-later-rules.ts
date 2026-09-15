import { LATER_ROUTES, type LaterWeek } from '@/lib/inmobiliaria/nutritionLater'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'

export function laterChoice(week: LaterWeek, lead: Row, history: Row[], outbound: Row[], partners: string[]) {
  const clients = history.filter(m => m.role === 'cliente').slice(-8)
  const recent = normalized(clients.map(m => text(m.content)).join(' '))
  const declared = [...clients].reverse().map(m => normalized(text(m.content)))
    .find(m => /para vivir|mi hogar|mi familia|para invertir|para rentar|para arrendar|mi negocio|negocio propio/.test(m)) || ''
  const positivePurpose = [...declared.matchAll(/para vivir|mi hogar|mi familia|para invertir|para rentar|para arrendar|mi negocio|negocio propio/g)]
    .filter(m => !/\bno(?: es| sera| quiero)?\s*$/.test(declared.slice(0, m.index))).at(-1)?.[0] || ''
  const purpose = declared ? /para vivir|mi hogar|mi familia/.test(positivePurpose) ? 'vivir'
    : /mi negocio|negocio propio/.test(positivePurpose) ? 'negocio' : positivePurpose ? 'invertir' : '' : text(lead.purchase_purpose)
  const categoryText = [...clients].reverse().map(m => normalized(text(m.content))).find(m => /\blocal|suite|departamento|vivienda/.test(m)) || ''
  const category = /\blocal/.test(categoryText) ? 'local' : /suite|departamento|vivienda/.test(categoryText) ? 'vivienda' : text(lead.preferred_category)
  let topic = '', action = ''
  if (week === 2) {
    topic = purpose === 'invertir' ? 'una propiedad para invertir' : category === 'local' ? purpose === 'negocio' ? 'un local para su negocio' : 'un local comercial'
      : purpose === 'vivir' ? 'un nuevo hogar' : 'el espacio adecuado para usted'
    action = 'invite_pending_questions'
  } else {
    const sent = normalized(outbound.map(m => text(m.content)).join(' '))
    const actions = outbound.flatMap(m => Object.values(object(m.tool_calls)).map(v => text(object(v).action)))
    const candidates: { action: string; topic: string }[] = []
    if (partners.length && /financ|credito|presupuesto|alcanz|\bjep\b|pichincha/.test(recent)
      && !/no (?:quiero|necesito|deseo).*financ|pago (?:de )?contado/.test(recent)
      && !/financiamiento|credito|pichincha|\bjep\b/.test(sent)) candidates.push({ action: 'financing_options', topic: 'conocer las alternativas de financiamiento' })
    if ((category || lead.unit_id || /comprar|compra|invertir/.test(recent)) && !/proceso de compra|firma.{0,35}reserva|reserva.{0,35}firma/.test(sent)) candidates.push({ action: 'purchase_process', topic: 'revisar el proceso de compra del inmueble que le interesa' })
    if (!/coordinar una (?:conversacion|llamada) con un asesor|asesor.{0,35}(?:contact|comunic)|(?:contact|comunic).{0,35}asesor/.test(sent)) candidates.push({ action: 'advisor_conversation', topic: 'coordinar una conversación con un asesor' })
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
