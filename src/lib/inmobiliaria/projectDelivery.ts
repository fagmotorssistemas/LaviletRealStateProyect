export const DELIVERY_TIMINGS = {
  unknown: 'Sin fecha estimada', date: 'Fecha completa', month: 'Mes y año',
  year: 'Solo año', duration: 'Plazo en meses',
} as const
export type ProjectDelivery = {
  enabled: boolean; timing: keyof typeof DELIVERY_TIMINGS; certainty: 'estimated' | 'confirmed'
  date: string; year: number | null; month: number | null; months: number | null
  reference: 'date' | 'construction_start'; referenceDate: string; conditions: string; source: string
}
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2200
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max
export function emptyProjectDelivery(): ProjectDelivery {
  return { enabled: false, timing: 'unknown', certainty: 'estimated', date: '', year: null, month: null,
    months: null, reference: 'date', referenceDate: '', conditions: '', source: '' }
}
export function validateProjectDelivery(value: unknown): ProjectDelivery {
  const v = row(value)
  if (typeof v.enabled !== 'boolean' || typeof v.timing !== 'string' || !Object.hasOwn(DELIVERY_TIMINGS, v.timing)
    || !['estimated', 'confirmed'].includes(String(v.certainty)) || !['date', 'construction_start'].includes(String(v.reference)))
    throw Error('Revise el formato y la precisión del plazo de entrega.')
  for (const [key, limit] of [['date', 10], ['referenceDate', 10], ['conditions', 700], ['source', 600]] as const)
    if (typeof v[key] !== 'string' || (v[key] as string).length > limit) throw Error('Revise los datos y la longitud de los textos de entrega.')
  for (const key of ['year', 'month', 'months'])
    if (v[key] !== null && !Number.isInteger(v[key])) throw Error('Los años y meses deben ser números enteros.')
  const current = { ...v, source: (v.source as string).trim(), conditions: (v.conditions as string).trim() } as ProjectDelivery
  // Disabled settings may retain an unfinished draft but cannot reach the bot.
  if (!current.enabled) return pickDelivery(current)
  if (current.timing === 'date' && !validDate(current.date)) throw Error('Indique una fecha de entrega válida.')
  if (['month', 'year'].includes(current.timing) && !integer(current.year, 1900, 2200)) throw Error('Indique un año válido entre 1900 y 2200.')
  if (current.timing === 'month' && !integer(current.month, 1, 12)) throw Error('Seleccione el mes de entrega.')
  if (current.timing === 'duration') {
    if (!integer(current.months, 1, 600)) throw Error('Indique un plazo entre 1 y 600 meses completos.')
    if ((current.reference === 'date' || current.referenceDate) && !validDate(current.referenceDate))
      throw Error('Indique la fecha desde la cual se cuenta el plazo. Si depende del inicio de obra aún desconocido, seleccione esa opción y deje la fecha vacía.')
  }
  if (current.timing !== 'unknown' && !current.source) throw Error('Indique la fuente o responsable que confirmó este plazo.')
  return pickDelivery(current)
}
function pickDelivery(v: ProjectDelivery): ProjectDelivery {
  return { enabled: v.enabled, timing: v.timing, certainty: v.certainty, date: v.date, year: v.year, month: v.month,
    months: v.months, reference: v.reference, referenceDate: v.referenceDate, conditions: v.conditions, source: v.source }
}
export function projectDeliverySettings(policies: unknown): { configured: boolean; value: ProjectDelivery; error?: string } {
  const saved = row(row(policies).project_delivery).current
  if (!saved) return { configured: false, value: emptyProjectDelivery() }
  try { return { configured: true, value: validateProjectDelivery(saved) } }
  catch { return { configured: false, value: emptyProjectDelivery(), error: 'La configuración de entrega guardada no es válida. Revísela y guarde de nuevo.' } }
}
export function changeProjectDelivery(policies: unknown, value: unknown, actor: string, now: string) {
  const current = validateProjectDelivery(value), original = row(policies), saved = row(original.project_delivery)
  return { ...original, project_delivery: { current, updatedAt: now, updatedBy: actor,
    history: [{ previous: saved.current || null, current, at: now, by: actor }, ...(Array.isArray(saved.history) ? saved.history : [])].slice(0, 20) } }
}
const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
function dateLabel(value: string, day = false) {
  const [y, m, d] = value.split('-').map(Number)
  return `${day ? `${d} de ` : ''}${monthNames[m - 1]} de ${y}`
}
/** Calendar arithmetic anchored to a stored reference, never to the day of the query. */
export function addDeliveryMonths(date: string, months: number) {
  if (!validDate(date) || !integer(months, 1, 600)) throw Error('Referencia o plazo inválido.')
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}
export function deliveryContext(policies: unknown, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date())) {
  const settings = projectDeliverySettings(policies), v = settings.value
  const unavailable = { available: false, status: settings.error ? 'invalid' : !settings.configured ? 'unconfigured' : !v.enabled ? 'disabled' : 'unknown',
    statement: 'No hay una fecha de entrega autorizada para comunicar, ni siquiera estimada.' }
  if (!settings.configured || !v.enabled || v.timing === 'unknown') return unavailable
  let date = '', label = '', precision = v.timing as string, duration: Record<string, unknown> | undefined
  if (v.timing === 'date') { date = v.date; label = dateLabel(date, true) }
  if (v.timing === 'month') { date = `${v.year}-${String(v.month).padStart(2, '0')}`; label = dateLabel(date) }
  if (v.timing === 'year') { date = String(v.year); label = date }
  if (v.timing === 'duration') {
    precision = 'month'
    duration = { months: v.months, reference: v.reference, reference_date: v.referenceDate || null }
    if (v.referenceDate) { date = addDeliveryMonths(v.referenceDate, v.months!).slice(0, 7); label = dateLabel(date) }
  }
  const elapsed = !!date && date < today.slice(0, date.length)
  let statement = date ? `${v.certainty === 'estimated' ? 'La entrega se estima' : 'La entrega está programada con fecha confirmada'} para ${label}.`
    : `El plazo de entrega ${v.certainty === 'estimated' ? 'estimado' : 'confirmado'} es de ${v.months} meses desde el inicio de obra. No hay una fecha de inicio registrada para calcular el mes y año de entrega.`
  if (v.timing === 'year') statement += ' No hay un mes de entrega definido.'
  if (v.timing === 'duration' && date) statement += ` El plazo de ${v.months} meses se cuenta desde ${v.reference === 'construction_start' ? 'el inicio de obra registrado el ' : 'el '}${dateLabel(v.referenceDate, true)}.`
  if (elapsed) statement = `La referencia de entrega ${v.certainty === 'estimated' ? 'estimada' : 'confirmada'} publicada era ${label}. Ese periodo ya pasó y requiere actualización; no acredita que la obra esté terminada o entregada.`
  return { available: true, status: elapsed ? 'needs_update' : 'published', certainty: v.certainty, precision,
    delivery: date || null, ...(duration ? { duration } : {}), statement, conditions: v.conditions || null, source: v.source }
}
export const PROJECT_DELIVERY_RULES = `PLAZO DE ENTREGA: use contexto_verificado.entrega_proyecto como fuente del calendario autorizado. Conserve su precisión (día, mes o solo año), su condición estimada o confirmada y las condiciones publicadas. Un año sin mes no autoriza inventar un mes. Un plazo en meses se cuenta desde la referencia guardada, nunca desde hoy; no lo convierta en meses restantes. Sin fecha conocida de inicio de obra no calcule una fecha calendario. Con status=needs_update explique que la referencia necesita actualizarse: no la prometa como futura ni deduzca que el proyecto ya se entregó. Con available=false no afirme que existe una fecha ni que se ha confirmado la inexistencia de un cronograma: diga que aún no tiene una fecha autorizada para compartir. El avance físico y la etapa comercial no determinan la entrega. No prometa avisar de futuras actualizaciones sin un seguimiento operativo confirmado. Responda la consulta y retome con naturalidad el siguiente paso pendiente, sin activar una derivación solo por no tener fecha.`
