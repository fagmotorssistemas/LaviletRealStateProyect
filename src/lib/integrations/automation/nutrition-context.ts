import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { NUTRITION_24H_BODY } from '@/lib/inmobiliaria/nutrition24h'
import { resolveCatalogReference } from './catalog-reference'

// Only the short topic is variable. The approved template is never replaced with
// arbitrary generated prose, pricing, promises or untrusted client instructions.
export function nutritionMessage(lead: Row, history: Row[], summary: Row, catalog: Row[]) {
  const clients = history.filter(m => m.role === 'cliente')
  const latest = normalized(text(clients.at(-1)?.content))
  const recent = normalized(clients.slice(-3).map(m => text(m.content)).join(' '))
  let topic = 'ayudarle con lo que necesite', context = 'general'
  const ids = Array.isArray(object(summary._unit_reference).ids) ? object(summary._unit_reference).ids as unknown[] : []
  const units = catalog.filter(unit => ids.includes(unit.id) && /^[a-zA-Z0-9-]{1,12}$/.test(text(unit.unit_number)))
  const currentReference = resolveCatalogReference(catalog, text(clients.at(-1)?.content))
  const latestCategory = /\blocal/.test(latest) ? 'local' : /suite/.test(latest) ? 'suite' : /departamento/.test(latest) ? 'departamento' : ''
  const relevantUnits = currentReference.hasUnitMention ? currentReference.matches : units.filter(unit => !latestCategory || unit.category === latestCategory)
  const unit = relevantUnits.length === 1 ? relevantUnits[0] : null
  if (/credito|financia|pichincha|\bjep\b|azuayo/.test(latest)) {
    topic = /credito directo/.test(latest) ? 'resolver sus dudas sobre las alternativas al crédito directo' : 'orientarle sobre las opciones de financiamiento'; context = 'financing'
  } else if (/presupuesto|cuento con|dispongo de|no se cuanto/.test(latest)) {
    topic = 'ayudarle a definir un presupuesto con el que se sienta cómodo'; context = 'budget'
  } else if (/precio|cuesta|valores?/.test(latest)) {
    topic = 'resolver sus dudas sobre los valores de las opciones que le interesan'; context = 'price'
  } else if (/sector|seguridad|cerca|ubicacion|verdes|revender|venderlo/.test(latest)) {
    topic = 'ampliar la información sobre el sector y lo que busca en su inversión o vivienda'; context = 'location'
  } else if (unit) {
    const label = unit.category === 'suite' ? 'la suite' : unit.category === 'local' ? 'el local' : 'el departamento'
    const sent = history.some(m => m.role === 'bot' && text(object(object(m.tool_calls).unit_model).unit_id) === unit.id)
    topic = sent ? `resolver sus dudas sobre el recorrido de ${label} ${text(unit.unit_number)}`.replace('de el ', 'del ')
      : `ampliar la información sobre ${label} ${text(unit.unit_number)}`
    context = sent ? 'unit_tour' : 'unit'
  } else if (/suite|departamento|local|vivienda/.test(recent) || lead.preferred_category) {
    const category = /\blocal/.test(latest) ? 'local' : /suite/.test(latest) ? 'suite' : /departamento/.test(latest) ? 'departamento' : text(lead.preferred_category)
    const labels: Record<string, string> = { suite: 'las suites', departamento: 'los departamentos', local: 'los locales' }
    topic = labels[category] ? `ampliar la información sobre ${labels[category]} que le interesan` : 'acompañarle a encontrar una opción acorde a lo que busca'; context = 'category'
  } else if (/proyecto|edificio|vilet/.test(recent)) { topic = 'resolver sus dudas sobre el proyecto'; context = 'project' }
  return { context, topic, body: NUTRITION_24H_BODY.replace('{{1}}', topic) }
}

export function nutritionLeadEligible(lead: Row) {
  return lead.bot_enabled === true && lead.channel_origin === 'whatsapp' && lead.tracking_consent === true
    && !lead.tracking_opt_out_at && (!lead.handoff_status || lead.handoff_status === 'none')
    && !['vendido', 'reservado', 'no_interesado', 'agendado', 'cerrado', 'perdido'].includes(text(lead.status))
    && !['cerrado', 'perdido', 'vendido'].includes(text(lead.stage))
}
