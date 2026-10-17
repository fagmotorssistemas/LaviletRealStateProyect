import { object, text, type Row } from './data'
import { NUTRITION_24H_BODY } from '@/lib/inmobiliaria/nutrition24h'
import { nutritionIntent, nutritionUnitLabel } from './nutrition-intent'

// Only the short topic is variable. The approved template is never replaced with
// arbitrary generated prose, pricing, promises or untrusted client instructions.
export function nutritionMessage(lead: Row, history: Row[], summary: Row, catalog: Row[]) {
  const intent = nutritionIntent(lead, summary)
  let topic = 'ayudarle con lo que necesite', context = 'general'
  const property = object(summary._property_context)
  const ids = Array.isArray(property.selected_ids) && property.selected_ids.length ? property.selected_ids
    : Array.isArray(object(summary._unit_reference).ids) ? object(summary._unit_reference).ids as unknown[] : lead.unit_id ? [lead.unit_id] : []
  const units = catalog.filter(unit => ids.includes(unit.id) && /^[a-zA-Z0-9-]{1,12}$/.test(text(unit.unit_number)))
  const relevantUnits = units.filter(unit => !intent.category || unit.category === intent.category)
  const unit = relevantUnits.length === 1 ? relevantUnits[0] : null
  if (intent.financing) {
    topic = 'orientarle sobre las opciones de financiamiento'; context = 'financing'
  } else if (intent.budget) {
    topic = 'ayudarle a definir un presupuesto con el que se sienta cómodo'; context = 'budget'
  } else if (intent.topics.has('purchase_price')) {
    topic = 'resolver sus dudas sobre los valores de las opciones que le interesan'; context = 'price'
  } else if (intent.topics.has('location')) {
    topic = 'ampliar la información sobre el sector y lo que busca en su inversión o vivienda'; context = 'location'
  } else if (unit) {
    const label = nutritionUnitLabel(unit.category)
    const sent = history.some(m => m.role === 'bot' && text(object(object(m.tool_calls).unit_model).unit_id) === unit.id)
    topic = sent ? `resolver sus dudas sobre el recorrido de ${label} ${text(unit.unit_number)}`.replace('de el ', 'del ')
      : `ampliar la información sobre ${label} ${text(unit.unit_number)}`
    context = sent ? 'unit_tour' : 'unit'
  } else if (!intent.informational && intent.category) {
    const category = intent.category
    const labels: Record<string, string> = { suite: 'las suites', departamento: 'los departamentos', penthouse: 'los penthouses', local: 'los locales' }
    topic = labels[category] ? `ampliar la información sobre ${labels[category]} que le interesan` : 'acompañarle a encontrar una opción acorde a lo que busca'; context = 'category'
  } else if (intent.informational || intent.topics.has('project_overview') || object(summary._turn_intent).objective === 'project_information') {
    topic = 'resolver sus dudas sobre el proyecto'; context = 'project'
  }
  return { context, topic, body: NUTRITION_24H_BODY.replace('{{1}}', topic) }
}

export function nutritionLeadEligible(lead: Row) {
  return lead.bot_enabled === true && lead.channel_origin === 'whatsapp' && lead.tracking_consent === true
    && !lead.tracking_opt_out_at && (!lead.handoff_status || lead.handoff_status === 'none')
    && !['vendido', 'reservado', 'no_interesado', 'agendado', 'cerrado', 'perdido'].includes(text(lead.status))
    && !['cerrado', 'perdido', 'vendido'].includes(text(lead.stage))
}
