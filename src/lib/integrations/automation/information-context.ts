import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'

/** Resolve the subject before choosing a presentation or a catalogue response. */
export function informationSubject(current: string, info: Row): 'project' | 'property' | null {
  const m = normalized(current)
  if (/precio|valor|financ|credito|cuanto|dormitorio|habitacion|\b\d{3}\b|visita|cita|agendar|constructora|entrega|ubicacion|sector|alrededor|cerca/.test(m)) return null
  const semantics = object(info.semantica_turno)
  const property = object(semantics.property)
  if (['compare', 'rank', 'select'].includes(text(property.operation)) || /\b(?:diferencia|comparar|comparacion|mas grande|mas barato)\b/.test(m)) return null
  const explicitProject = /(?:informacion|detalles|cuenteme|cuentame|hablame).*(?:proyecto|edificio)/.test(m)
  const generic = /^(?:(?:hola|buenos dias|buenas tardes|buenas noches|por favor|si)\s+)*(?:(?:quiero|quisiera|necesito|deseo|me gustaria|envieme|compartame)\s+)?(?:mas\s+)?(?:informacion|info|detalles)(?:\s+por favor)?$/.test(m)
    || /^(?:(?:hola|buenos dias|buenas tardes|buenas noches)\s+)*(?:por favor\s+)?(?:compartame|comparteme|envieme|mandeme)\s+(?:mas\s+)?informacion(?:\s+por favor)?$/.test(m)
  const interpreted = semantics.primary_intent === 'project_information' && semantics.confidence === 'high'
    && !property.category && !property.group && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length)
  if (!explicitProject && !generic && !interpreted) return null
  // A mixed request must remain available to the complete response planner.
  if (Array.isArray(semantics.requests) && semantics.requests.map(object).filter(request => request.domain !== 'courtesy').length > 1) return null
  if (explicitProject) return 'project'
  const context = object(info.property_context)
  const query = object(context.query)
  const pending = object(info.pregunta_pendiente || context.pending_question)
  const history = (Array.isArray(info.historial) ? info.historial : []).map(object)
  const last = normalized(text(history.filter(row => ['bot', 'asesor'].includes(text(row.role))).at(-1)?.content))
  const focus = ['selected_ids', 'focused_ids', 'offered_ids', 'comparison_ids'].some(key => Array.isArray(context[key]) && context[key].length)
    || !!query.category || Object.values(object(query.filters)).some(value => value != null)
    || ['show_unit_details', 'choose_unit', 'explore_alternatives'].includes(text(pending.act))
    || /\b(?:departamento|penthouse|suite|local)\s+\d{3}\b/.test(last)
    || ['followup', 'comparison', 'explicit'].includes(text(property.reference_kind))
  return focus ? 'property' : 'project'
}
