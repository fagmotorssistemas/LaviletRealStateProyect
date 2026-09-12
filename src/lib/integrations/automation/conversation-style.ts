import { formatVisitWhen } from '@/lib/inmobiliaria/visitClock'
import { ecuadorYmd } from '@/lib/inmobiliaria/agendaTime'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'

export function conversationalFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || ''
}
export function isCourtesyOnly(message: string) {
  // «Está bien», «de acuerdo» u «ok» también pueden autorizar una propuesta.
  return /^(?:(?:perfecto|muchas gracias|muchisimas gracias|gracias|con mucho gusto|muy amable|muy bien|excelente|entendido|hasta luego|igualmente|estare puntual|ahi estare|alli estare|nos vemos|le esperamos|hasta entonces)\s*)+$/.test(normalized(message))
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
  if (/buen[oa]s? (?:dias|días|tardes|noches)/.test(value)) return localGreeting(at)
  return value[0].toLocaleUpperCase('es') + value.slice(1)
}
export function localGreeting(at: string) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)))
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'
}
export function naturalConversationReply(reply: string, name: string, greeting: string, at?: string) {
  const full = name.trim(), first = conversationalFirstName(full)
  let result = reply.trim().replace(/\\n/g, '\n').replace(/\bamenidades\b/gi, 'instalaciones').replace(/p\. m\.\.|a\. m\.\./g, value => value.slice(0, -1))
  if (at) result = result.replace(/^(hola[, .!]*\s*)?buen(?:os días|as tardes|as noches)/i, (_, hola: string) => (hola || '') + localGreeting(at))
  if (full && full !== first) result = result.replace(new RegExp(full.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&'), 'gi'), first)
  if (greeting && !/^(hola\b|buenos d[ií]as\b|buen d[ií]a\b|buenas\b)/i.test(result)) result = greeting + '. ' + result
  return result
}
export function minimalGreeting(greeting: string) {
  return `${greeting || 'Hola'}, un gusto saludarle. ¿En qué podemos ayudarle?`
}
export function visitCoordinationReply(slot: Row, counterproposal = false) {
  if (slot.start_time && slot.confidence === 'exact') {
    return (counterproposal ? 'Claro' : 'Perfecto') + ', revisaremos la disponibilidad para ' + formatVisitWhen(text(slot.start_time)) + ' Le confirmaremos por aquí en cuanto el equipo revise ese horario.'
  }
  if (slot.requested_date && slot.has_time) return 'Claro, solo para coordinar bien: ¿se refiere a ese horario en la mañana o en la tarde?'
  if (slot.requested_date) return 'Claro, con gusto. ¿A qué hora le gustaría visitarnos ese día?'
  if (slot.has_time) return 'Con gusto. ¿Qué día le gustaría visitarnos a esa hora?'
  return counterproposal
    ? 'No se preocupe, buscamos otra opción. ¿Qué día y hora le vendrían mejor?'
    : 'Con gusto coordinamos su visita. ¿Qué día y a qué hora le gustaría venir?'
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
  'Diga instalaciones, nunca amenidades. No mencione La Vilet ni el nombre del cliente en cada turno; use el nombre del proyecto solo cuando aporta contexto nuevo.',
  'Evite gracias por comentarlo/aclararlo y repetir Perfecto. Conteste directamente con interés real, sin recapitular todo lo conocido.',
  'Un saludo o puntuación aislada solo merece saludo y ofrecer ayuda; no asuma intención de compra ni presente el catálogo.',
  'Use Hola como saludo neutral. Nunca invente buenas noches; respete la hora de Ecuador proporcionada por el sistema.',
  'Si no tiene claro el presupuesto, ofrezca ayudarle a estimarlo según entrada y una cuota cómoda, o explicar opciones de financiamiento. No lo desvíe a tamaños o visita sin resolver su duda.',
  'Cuando pregunta por la ubicación del edificio, explique la dirección. No la convierta en preferencia por un piso.',
  'No generalice balcones, terrazas, bodegas ni distribución a todas las unidades: solo describa atributos explícitos de una unidad verificada. No afirme permisos, rentabilidad ni aptitud para Airbnb.',
  'La ausencia de un atributo en el catálogo significa que no está verificado, no que esa unidad carezca de él. Tampoco invente cercanía a servicios o vías principales sin datos que la respalden.',
  'Superficies del catálogo: area_internal_m2 es área interior, area_exterior_m2 es área exterior y area_total_m2 es el total registrado; todas están en m². Conteste con las superficies disponibles de la unidad consultada aunque area_total_m2 sea null. Distinga interior y exterior; no llame total al área interior ni invente un total oficial sumando campos. Un área exterior null significa sin registrar, no cero ni ausencia de exterior. No describa el exterior como terraza, jardín o área exclusiva sin datos que lo confirmen. Ejemplo: LC-02 con interior 95.37 y exterior 46.74 se describe como «95,37 m² interiores y 46,74 m² exteriores».',
  'Ejemplo de precisión: si solo consta balcón para el 202, diga «En el 202 consta balcón; para las demás opciones falta verificarlo». No diga «No todos tienen balcón» ni «El 301 no lo incluye» a partir de un campo ausente.',
  'Nunca sugiera una fecha/hora de visita por iniciativa propia: los horarios los propone el asesor desde su agenda. Si pide sugerencia o expresa incertidumbre, el sistema debe coordinarla; no repita preguntas ni invente viernes a las 16.',
].join('\n')
