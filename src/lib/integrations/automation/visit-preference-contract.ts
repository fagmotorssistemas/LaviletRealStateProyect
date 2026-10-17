import type { Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

export const VISIT_PREFERENCE_VERSION = 'visit-preference-v2'
const dateKinds = ['absolute', 'relative_day', 'weekday', 'month_day', 'unchanged', 'none'] as const
const timeKinds = ['clock', 'period', 'unchanged', 'none'] as const
const decisions = ['specified', 'ambiguous', 'declined', 'none'] as const
const places = ['office', 'site', 'work_area', 'model', 'completed_unit'] as const
const integer = { type: ['integer', 'null'] }
const closed = (properties: Row) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })

export const VISIT_PREFERENCE_SCHEMA = closed({
  version: { type: 'string', enum: [VISIT_PREFERENCE_VERSION] },
  decision: { type: 'string', enum: [...decisions], description: 'specified si aporta fecha, hora O lugar. none exige date.kind=none, time.kind=none, location_type=null y uncertain_fields=[].' },
  date: closed({ kind: { type: 'string', enum: [...dateKinds] }, year: integer, month: integer, day: integer,
    offset_days: integer, weekday: integer, week_offset: integer,
    occurrence: { type: ['string', 'null'], enum: ['on_or_after', 'strictly_next', null] } }),
  time: closed({ kind: { type: 'string', enum: [...timeKinds] }, hour: integer, minute: integer,
    meridiem: { type: ['string', 'null'], enum: ['am', 'pm', '24h', null] },
    period: { type: ['string', 'null'], enum: ['morning', 'afternoon', 'evening', null] } }),
  uncertain_fields: { type: 'array', items: { type: 'string', enum: ['date', 'time', 'location'] } },
  location_type: { type: ['string', 'null'], enum: [...places, null] },
  evidence: { type: 'string' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  source: closed({ kind: { type: 'string', enum: ['current', 'history'] }, message_id: { type: ['string', 'null'],
    description: 'ID persistido de current_messages o de un mensaje de cliente del historial; los IDs current:N de fragmentos no son IDs de mensajes. null si no hay ID provisto.' } }),
})

/** Bound provider choices to real message identities, independently of wording. */
export function visitPreferenceSchemaForSources(input: Row): Row {
  const current = (Array.isArray(input.current_messages) ? input.current_messages : []).map(row)
  const history = (Array.isArray(input.historial || input.historial_reciente) ? input.historial || input.historial_reciente : []) as unknown[]
  const identifiers = [...new Set([str(input.source_message_id), ...current.flatMap(item => [str(item.external_message_id), str(item.id)]),
    ...history.map(row).filter(item => ['cliente', 'user'].includes(str(item.role)))
      .flatMap(item => [str(item.external_message_id), str(item.message_id), str(item.id)])].filter(Boolean))]
  return { ...VISIT_PREFERENCE_SCHEMA, properties: { ...VISIT_PREFERENCE_SCHEMA.properties,
    source: closed({ kind: { type: 'string', enum: ['current', 'history'] },
      message_id: { type: ['string', 'null'], enum: [...identifiers, null], description: 'Use solo uno de estos IDs persistidos. Los identificadores de fragmentos tienen otro propósito.' } }) } }
}

export const VISIT_PREFERENCE_EXTRACTION_RULES = `En mensajes agrupados, visit_preferences contiene una preferencia por mensaje de origen de current_messages, con su ID real y su evidencia literal. Separe fecha y hora si proceden de mensajes diferentes; use [] cuando no hay componentes adicionales. El servidor conserva sus fuentes y orden. No atribuya a un mensaje el contenido de otro. visit_preference usa exclusivamente el contrato visit-preference-v2 del esquema. La IA interpreta el lenguaje; no hay un parser posterior de palabras, fechas escritas ni horas escritas. No devuelva date_text, time_text ni canonical_text.
decision=specified cuando aporta UNA fecha, hora O lugar identificados, aunque falten los demás componentes. Por ejemplo, pedir una visita a la oficina sin día ni hora lleva decision=specified, date.kind=none, time.kind=none, location_type=office: el lugar ya es una preferencia válida. No clasifique eso como none ni ambiguous por faltar fecha/hora. ambiguous identifica alternativas o ambigüedad del componente expresado; declined rechaza una preferencia. none exige date.kind=none, time.kind=none, location_type=null y uncertain_fields=[]. uncertain_fields identifica los datos realmente ambiguos o rechazados y no borra los demás.
date.kind: absolute lleva year/month/day; relative_day lleva offset_days respecto de la fecha local del mensaje de origen; weekday lleva weekday ISO (lunes=1), week_offset para una semana calendario concreta (0=actual, 1=siguiente), o week_offset=null y occurrence=on_or_after/strictly_next para la próxima ocurrencia; month_day lleva month/day y year=null; unchanged conserva la fecha ya demostrada; none no aporta fecha. Los campos no usados son null. Puede incluir weekday junto con absolute/month_day si el cliente indicó ambos: el calendario comprobará que coincidan.
time.kind=clock lleva hour/minute y meridiem am/pm/24h. Si expresó solo una hora de 1 a 12 sin distinguir mañana/tarde, use meridiem=null; no elija una franja por iniciativa propia. period lleva morning/afternoon/evening; unchanged conserva la hora demostrada; none no aporta hora. Los demás campos son null.
La hora, día, correcciones, repeticiones, negaciones y alternativas las decide la IA según el significado completo. Una repetición oral de la misma opción no crea varias opciones. Si la pregunta pendiente pide fecha, una afirmación confirma solo la referencia demostrada por ese contexto, no acepta un cupo del asesor ni otra gestión.
source.kind=current atribuye evidence literal al mensaje actual y message_id copia el external_message_id de current_messages o source_message_id; use null cuando no se proporciona un ID. Los IDs current:N de mensajes_actuales identifican fragmentos informativos, NO mensajes persistidos: no los copie en source.message_id. Para recuperar una preferencia original citada por una respuesta breve, source.kind=history exige el ID exacto de un mensaje de cliente provisto y evidence literal de ese mensaje; nunca use un mensaje del bot como declaración del cliente. La respuesta actual debe estar vinculada a visit_date_time en una coordinación vigente. No cambie una fecha relativa por una fecha absoluta calculada por usted: la resuelve el calendario con el instante original.
location_type solo recoge el lugar expresamente pedido o aceptado. No cambie building por office ni acepte una alternativa por consultar horarios. Una preferencia no registra ni confirma una cita por sí sola.`

export type VisitDate = { kind: typeof dateKinds[number]; year: number | null; month: number | null; day: number | null;
  offset_days: number | null; weekday: number | null; week_offset: number | null; occurrence: 'on_or_after' | 'strictly_next' | null }
export type VisitTime = { kind: typeof timeKinds[number]; hour: number | null; minute: number | null;
  meridiem: 'am' | 'pm' | '24h' | null; period: 'morning' | 'afternoon' | 'evening' | null }
export type VisitPreference = { version: typeof VISIT_PREFERENCE_VERSION; decision: typeof decisions[number]; date: VisitDate; time: VisitTime;
  uncertain_fields: ('date' | 'time' | 'location')[]; location_type: typeof places[number] | null; evidence: string; confidence: 'high' | 'medium';
  source: { kind: 'current' | 'history'; message_id: string | null }; source_at?: string }
export type VisitPreferenceContext = { sourceMessageId?: string; sourceAt?: string; history?: unknown; pendingQuestion?: unknown;
  answer?: unknown; collecting?: boolean; currentMessages?: unknown }

const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const str = (value: unknown) => typeof value === 'string' ? value : ''
const member = <T extends readonly string[]>(values: T, value: unknown): value is T[number] => typeof value === 'string' && values.includes(value)
const inRange = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const nullable = (value: unknown) => value === null || value === undefined
const unused = (value: Row, keys: string[]) => keys.every(key => nullable(value[key]))
const literal = (quote: string, message: string) => quote.length > 0 && quote.length <= 1000
  && message.normalize('NFKC').toLowerCase().includes(quote.normalize('NFKC').toLowerCase())

export function validVisitDate(input: unknown): input is VisitDate {
  const date = row(input)
  if (!member(dateKinds, date.kind)) return false
  const rest = ['year', 'month', 'day', 'offset_days', 'weekday', 'week_offset', 'occurrence']
  if (['none', 'unchanged'].includes(date.kind)) return unused(date, rest)
  if (date.kind === 'relative_day') return inRange(date.offset_days, -366, 3660)
    && unused(date, rest.filter(key => key !== 'offset_days'))
  if (date.kind === 'weekday') return inRange(date.weekday, 1, 7) && unused(date, ['year', 'month', 'day', 'offset_days'])
    && (inRange(date.week_offset, 0, 104) && nullable(date.occurrence)
      || nullable(date.week_offset) && ['on_or_after', 'strictly_next'].includes(str(date.occurrence)))
  return inRange(date.month, 1, 12) && inRange(date.day, 1, 31)
    && (date.kind === 'absolute' ? inRange(date.year, 1, 9999) : nullable(date.year))
    && (nullable(date.weekday) || inRange(date.weekday, 1, 7)) && unused(date, ['offset_days', 'week_offset', 'occurrence'])
}

export function validVisitTime(input: unknown): input is VisitTime {
  const time = row(input)
  if (!member(timeKinds, time.kind)) return false
  if (['none', 'unchanged'].includes(time.kind)) return unused(time, ['hour', 'minute', 'meridiem', 'period'])
  if (time.kind === 'period') return ['morning', 'afternoon', 'evening'].includes(str(time.period))
    && unused(time, ['hour', 'minute', 'meridiem'])
  return inRange(time.minute, 0, 59) && nullable(time.period)
    && (time.meridiem === '24h' ? inRange(time.hour, 0, 23)
      : (nullable(time.meridiem) || ['am', 'pm'].includes(str(time.meridiem))) && inRange(time.hour, 1, 12))
}

/** Schema, literal provenance and context only. No words determine a date, time,
 * negation, alternative or confidence here; those are the AI's typed decisions. */
export function normalizedVisitPreference(raw: unknown, current: string, context: VisitPreferenceContext = {}): VisitPreference | null {
  const preference = row(raw), source = row(preference.source), evidence = str(preference.evidence).trim()
  if (preference.version !== VISIT_PREFERENCE_VERSION || !member(decisions, preference.decision)
    || !acceptedExtractorConfidence(preference.confidence) || !validVisitDate(preference.date) || !validVisitTime(preference.time)
    || !['current', 'history'].includes(str(source.kind)) || !Array.isArray(preference.uncertain_fields)
    || preference.uncertain_fields.some(value => !['date', 'time', 'location'].includes(str(value)))
    || !nullable(preference.location_type) && !member(places, preference.location_type)) return null
  if (preference.decision === 'none' && (row(preference.date).kind !== 'none' || row(preference.time).kind !== 'none'
    || !nullable(preference.location_type) || preference.uncertain_fields.length > 0)) return null
  let sourceId = str(source.message_id) || null, sourceAt = context.sourceAt
  if (source.kind === 'current') {
    if (!literal(evidence, current)) return null
    const supplied = Array.isArray(context.currentMessages) ? context.currentMessages.map(row) : []
    if (supplied.length) {
      const sourceMessage = supplied.find(item => [str(item.external_message_id), str(item.id)].includes(sourceId || context.sourceMessageId || ''))
      if (!sourceMessage || !literal(evidence, str(sourceMessage.content))) return null
      sourceId = str(sourceMessage.external_message_id) || str(sourceMessage.id)
      sourceAt = str(sourceMessage.sent_at) || sourceAt
    } else {
      if (sourceId && context.sourceMessageId && sourceId !== context.sourceMessageId) return null
      sourceId ||= context.sourceMessageId || null
    }
  } else {
    const answer = row(context.answer), pending = row(context.pendingQuestion)
    if (!context.collecting || pending.id !== 'visit_date_time' || answer.question_id !== pending.id
      || !['affirmative', 'value'].includes(str(answer.kind)) || !acceptedExtractorConfidence(answer.confidence)
      || !literal(str(answer.evidence), current) || !sourceId) return null
    const originals = (Array.isArray(context.history) ? context.history : []).map(row)
    const original = originals.find(item => ['cliente', 'user'].includes(str(item.role))
      && [str(item.id), str(item.external_message_id), str(item.message_id)].includes(sourceId!))
    if (!original || !literal(evidence, str(original.content))) return null
    sourceAt = str(original.sent_at) || undefined
  }
  return { version: VISIT_PREFERENCE_VERSION, decision: preference.decision, date: preference.date, time: preference.time,
    uncertain_fields: [...new Set(preference.uncertain_fields)] as VisitPreference['uncertain_fields'],
    location_type: nullable(preference.location_type) ? null : preference.location_type as VisitPreference['location_type'],
    evidence, confidence: preference.confidence, source: { kind: source.kind as 'current' | 'history', message_id: sourceId },
    ...(sourceAt ? { source_at: sourceAt } : {}) }
}
