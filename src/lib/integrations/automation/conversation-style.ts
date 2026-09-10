import { formatVisitWhen } from '@/lib/inmobiliaria/visitClock'
import { ecuadorYmd } from '@/lib/inmobiliaria/agendaTime'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'

export function conversationalFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || ''
}
export function isCourtesyOnly(message: string) {
  // «Está bien», «de acuerdo» u «ok» también pueden autorizar una propuesta.
  return /^(?:(?:perfecto|muchas gracias|muchisimas gracias|gracias|con mucho gusto|muy amable|muy bien|excelente|entendido|hasta luego|igualmente)\s*)+$/.test(normalized(message))
}
export function greetingForTurn(current: string, history: unknown, lastBotAt: unknown, at: string) {
  const match = current.trim().match(/^(hola\b|buenos d[ií]as\b|buen d[ií]a\b|buenas tardes\b|buenas noches\b|buenas\b)/i)
  if (!match) return ''
  const previous = (Array.isArray(history) ? history : []).map(object)
    .filter(r => ['bot', 'asesor'].includes(text(r.role))).map(r => Date.parse(text(r.sent_at)))
  const last = Math.max(0, Date.parse(text(lastBotAt)) || 0, ...previous.filter(Number.isFinite))
  const now = Date.parse(at)
  if (last && ecuadorYmd(new Date(last)) === ecuadorYmd(new Date(now)) && now - last < 15 * 60_000) return ''
  const value = match[0].toLocaleLowerCase('es')
  return value[0].toLocaleUpperCase('es') + value.slice(1)
}
export function naturalConversationReply(reply: string, name: string, greeting: string) {
  const full = name.trim(), first = conversationalFirstName(full)
  let result = reply.trim()
  if (full && full !== first) result = result.replace(new RegExp(full.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&'), 'gi'), first)
  if (greeting && !/^(hola\b|buenos d[ií]as\b|buen d[ií]a\b|buenas\b)/i.test(result)) result = greeting + '. ' + result
  return result
}
export function visitCoordinationReply(slot: Row, counterproposal = false) {
  if (slot.start_time && slot.confidence === 'exact') {
    return (counterproposal ? 'Claro' : 'Perfecto') + ', revisaremos la disponibilidad para ' + formatVisitWhen(text(slot.start_time)) + '. Le confirmaremos por aquí en cuanto el equipo revise ese horario.'
  }
  if (slot.requested_date && slot.has_time) return 'Claro, solo para coordinar bien: ¿se refiere a ese horario en la mañana o en la tarde?'
  if (slot.requested_date) return 'Claro, con gusto. ¿A qué hora le gustaría visitarnos ese día?'
  if (slot.has_time) return 'Con gusto. ¿Qué día le gustaría visitarnos a esa hora?'
  return counterproposal
    ? 'No se preocupe, buscamos otra opción. ¿Qué día y hora le vendrían mejor?'
    : 'Con gusto coordinamos su visita a La Vilet. ¿Qué día y a qué hora le gustaría venir?'
}
export const NATURAL_CONVERSATION_RULES = [
  'Conversación natural:',
  'Use solo el primer nombre del cliente, de forma ocasional; nunca nombre completo.',
  'Un agradecimiento sin consulta merece un cierre breve; no repita resumen, horario, registro ni otra pregunta de venta.',
  'Responda al saludo al retomar la conversación en un nuevo día o después de una pausa. No vuelva a presentarse en mensajes consecutivos.',
  'Para agendar, conserve el día y la hora que el cliente ya dio dentro de la misma coordinación. Pregunte únicamente el dato que falta.',
  'Si rechaza un horario, muestre comprensión y pregunte su alternativa. Si ya la dijo, reconózcala sin pedirla de nuevo.',
  'No afirme reserva, confirmación ni cancelación salvo que el resultado del sistema las respalde. No mencione al asesor antes de confirmar la cita.',
  'Sin emojis, sin fingir identidad humana. Mantenga el trato de usted cercano y sencillo.',
].join('\n')
