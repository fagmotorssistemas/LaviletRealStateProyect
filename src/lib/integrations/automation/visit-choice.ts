import { object, text } from './data'
import { visitDetailText } from './visit-intake'

// Only a unique choice is actionable. A generic "sí" cannot select the first
// of several appointments, and a question is never consent to book one.
export function selectedVisitOption(current: string, options: unknown, sentAt: string): number | null {
  const slots = (Array.isArray(options) ? options : []).map(object)
  if (slots.length < 2 || slots.length > 3) return null
  // The routing normalizer removes punctuation. Protect a clock's colon so
  // 08:30 can never become 08:00 during selection.
  const m = visitDetailText(current.replace(/:/g, 'minutoseparator')).replace(/minutoseparator/g, ':')
  if (/\b(?:departamentos?|suites?|local(?:es)?|dormitorios?|cuotas?|financiamiento|creditos?|precios?|dolares|vuelos?|motos?|autos?|cancel\w*|anul\w*|reagendar|reprogramar|dejen|baja|no me contacten)\b/.test(m)) return null
  if (/\b(?:que|cual|como|cuando|donde|cuenteme|expliqueme|expliquen|digame|informacion|detalles|consulta)\b/.test(m)) return null
  if (/[¿?]/.test(current) || /\b(?:no|ninguna|ninguno|pero|quizas|tal vez|mejor otra|otra opcion|puedo|podria|siempre que|si es posible)\b/.test(m)) return null
  if (/\d{1,2}[/-]\d{1,2}|\b\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i.test(current)) return null
  const indices = [...m.matchAll(/\b(primer[oa]?|segund[oa]?|tercer[oa]?)\b|\b(?:opcion|horario|la|el) ([123])\b/g)]
    .map(hit => /^primer/.test(hit[1] || '') ? 1 : /^segund/.test(hit[1] || '') ? 2 : /^tercer/.test(hit[1] || '') ? 3 : Number(hit[2]))
  if (/^[123]$/.test(m)) indices.push(Number(m))
  const choicePhrase = /\b(?:primer[oa]?|segund[oa]?|tercer[oa]?|(?:opcion|horario|la|el) [123])\b/.test(m) || /^[123]$/.test(m)
  const temporal = /\b(?:manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|a las?|las? \d|las? (?:ocho|nueve|diez|once|doce))\b|\d{1,2}:\d{2}/.test(m)
  const ordinal = choicePhrase && new Set(indices).size === 1 && indices[0] <= slots.length ? indices[0] : null
  if (choicePhrase && ordinal === null) return null
  if (ordinal !== null && !temporal) return ordinal
  const words: Record<string, number> = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 }
  const clock = m.match(/\b(?:a las?|las?|horario de las?) (\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?::(\d{2}))?\b/)
  if (!clock) return null
  const hour = words[clock[1]] ?? Number(clock[1]), minute = Number(clock[2] || 0)
  if (hour > 23 || minute > 59) return null
  const ymd = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
  let requestedDay = ''
  const sourceDay = ymd(sentAt)
  if (/\b(?:para )?manana\b/.test(m) && !/\b(?:de|por|en) la manana\b/.test(m)) {
    requestedDay = ymd(new Date(Date.parse(`${sourceDay}T12:00:00-05:00`) + 86400000).toISOString())
  } else if (/\bhoy\b/.test(m)) requestedDay = sourceDay
  const namedDay = m.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/)?.[1]
  const period = /\b(?:pm|p m|tarde|noche)\b/.test(m) ? 'pm' : /\b(?:am|a m|de la manana|por la manana)\b/.test(m) ? 'am' : ''
  const matches = slots.flatMap((slot, index) => {
    const value = text(slot.start_time), date = new Date(value)
    if (!Number.isFinite(date.getTime())) return []
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
    const h = Number(parts.find(p => p.type === 'hour')?.value), min = Number(parts.find(p => p.type === 'minute')?.value)
    const weekday = visitDetailText(new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', weekday: 'long' }).format(date))
    const expected = period === 'pm' ? hour % 12 + 12 : period === 'am' ? hour % 12 : hour
    return min === minute && (h === expected || (!period && hour <= 12 && h % 12 === hour % 12))
      && (!requestedDay || requestedDay === ymd(value)) && (!namedDay || namedDay === weekday) ? [index + 1] : []
  })
  return matches.length === 1 && (ordinal === null || ordinal === matches[0]) ? matches[0] : null
}
