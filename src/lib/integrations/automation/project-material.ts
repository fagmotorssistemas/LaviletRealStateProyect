import { object, text } from './data'
import { normalized } from './sdr-rules'

export const BROCHURE_PATH = '/materiales/brochure-la-vilet-v5.pdf'
export const BROCHURE_URL = `https://www.lavilett.com${BROCHURE_PATH}`
const rows = (history: unknown) => (Array.isArray(history) ? history : []).map(object)

export function vehicleScopeReply(current: string, history: unknown = []) {
  const m = normalized(current)
  // Questions about parking or paying for property with a vehicle remain property questions.
  if (/parque|garaje|estacion|entrada|abono|parte de pago|permuta|entregar|reciben|aceptan|vendo mi|vender mi/.test(m)) return ''
  const explicit = /\b(?:carro|auto|vehiculo|coche|camioneta|moto)s?\b/.test(m)
  const clients = rows(history).filter(row => row.role === 'cliente').slice(-4).reverse()
  let previousVehicle = false
  for (const row of clients) {
    const message = normalized(text(row.content))
    if (/suite|departamento|vivienda|local|proyecto/.test(message)) break
    if (/\b(?:carro|auto|vehiculo|coche|camioneta|moto)s?\b/.test(message)) { previousVehicle = true; break }
  }
  const followup = previousVehicle && /recomiend|sugier|quiero uno|cual|cuanto|precio|rentar|rento|comprar/.test(m) && !/suite|departamento|vivienda|local|proyecto/.test(m)
  if (!explicit && !followup) return ''
  const alternatives = [
    'Lamento no poder ayudarle con la búsqueda de un vehículo; no los vendemos ni alquilamos. En La Vilet ofrecemos suites, departamentos y locales comerciales, y será un gusto orientarle si alguno le interesa.',
    'Me gustaría poder orientarle, pero no vendemos ni alquilamos vehículos. Nos dedicamos a suites, departamentos y locales comerciales en La Vilet. Si le interesa alguna de estas opciones, con gusto le ayudo.',
    'Disculpe, con vehículos no podemos ayudarle, pues no los vendemos ni alquilamos. Nuestra especialidad son las suites, departamentos y locales comerciales de La Vilet. Aquí estamos si desea conocerlos.',
  ]
  // Use only delivered replies to vary the tone; a client's text cannot select the wording.
  const replies = rows(history).filter(row => ['bot', 'asesor'].includes(text(row.role))).slice(-6)
    .map(row => normalized(text(row.content)))
  // Least recently used also varies the response after all alternatives have appeared.
  return alternatives.reduce((best, candidate) => {
    const lastUse = (reply: string) => replies.findLastIndex(sent => sent.includes(normalized(reply)))
    return lastUse(candidate) < lastUse(best) ? candidate : best
  })
}

export function wantsBrochure(current: string, history: unknown = []) {
  const m = normalized(current)
  if (/\bno\b.{0,40}(?:envie|mande|quiero|necesito|compart|brochure|folleto|informacion)/.test(m)) return false
  if (/brochure|brochur|folleto|catalogo|\bpdf\b/.test(m)) return true
  if (/(?:compart|envi|mand|pas)[a-z]*.{0,30}(?:informacion|info\b|material|detalle)/.test(m)) return true
  const last = text(rows(history).filter(row => row.role === 'bot').at(-1)?.content)
  return /^(?:si|si por favor|claro|de acuerdo|si gracias|si compartame|por favor)$/.test(m)
    && /(?:compart|envi|mand|pas)[a-z]*.{0,45}(?:informaci[oó]n|material|brochure|folleto)/i.test(last)
}

export function brochureReply(current: string, history: unknown, mode: string) {
  if (!wantsBrochure(current, history)) return ''
  if (/precio|cuesta|financ|credito|entrega|cuando|fecha|dormitorio|sector|ubicacion|\b\d{3}\b|foto|modelo|plano/.test(normalized(current))) return ''
  const launch = mode === 'lanzamiento'
  return launch
    ? `Le comparto el brochure para que pueda conocer la propuesta y sus espacios. Las imágenes muestran cómo está previsto el proyecto; todavía no hay departamentos construidos.\n\n${BROCHURE_URL}`
    : `Aquí puede revisar el brochure y conocer mejor los espacios del proyecto:\n\n${BROCHURE_URL}`
}

export function launchVisitReply(reply: string, destination: 'site' | 'office') {
  const place = destination === 'office' ? 'nuestra oficina, en la dirección del proyecto' : 'el terreno donde se construirá La Vilet'
  if (/¿Qué día y a qué hora le gustaría venir\?/.test(reply)) return `Podemos recibirle en ${place}. ¿Qué día y a qué hora le gustaría venir?`
  return reply
}

export const LAUNCH_PROJECT_RULES = `En Lanzamiento la construcción todavía no ha comenzado y no hay departamentos terminados ni avances físicos que mostrar. Las imágenes y el brochure ilustran el proyecto previsto. Hay oficina de atención en la misma dirección del terreno.
No invite a recorrer o conocer un departamento construido, ni sugiera showroom disponible. Si propone una visita, siga exclusivamente politica_visitas: conocer el terreno donde se construirá el proyecto o la oficina para revisar la propuesta. No invente fechas de inicio ni entrega.
No ofrezca compartir material sin adjuntarlo cuando el cliente lo solicita o acepta. El brochure es una presentación del proyecto, no prueba de avance de obra.`
