import { object,text } from './data'
import { hasAffordabilityConcern } from './financing'
import { normalized } from './sdr-rules'

export type CommercialTurnTopic = 'price' | 'options' | 'affordability' | 'parking' | 'location' | 'financing' | 'pets'

// A coverage checklist for the whole buffered customer turn. It supplies no
// property facts and authorizes no action; scope and verified context still own
// those decisions. A finance shortcut can use it to preserve unrelated questions.
export function commercialTurnTopics(current: string, _history: unknown = [], _propertyScope = false, interpreted: unknown = {}): CommercialTurnTopic[] { void _history; void _propertyScope;
  const info = object(interpreted), semantics = object(info.semantica_turno || info.turn_semantics || info)
  const requests = (Array.isArray(semantics.requests) ? semantics.requests : []).map(object)
  const mapping: Record<string, CommercialTurnTopic> = { purchase_price: 'price', property_options: 'options',
    financing: 'financing', monthly_payment: 'financing', location: 'location', parking: 'parking', pets: 'pets' }
  const topics = requests.flatMap(request => Array.isArray(request.topics) ? request.topics.map(text).flatMap(topic => mapping[topic] ? [mapping[topic]] : []) : [])
  if (hasAffordabilityConcern(current, semantics)) topics.push('affordability')
  return [...new Set(topics)]
}

const answerEvidence: Record<CommercialTurnTopic, RegExp> = {
  price: /\$\s*\d|\b\d[\d.,]*\s*(?:usd|dolares)|\b(?:precio|valor|cotizacion)\b/,
  options: /\b(?:suites?|departamentos?|viviendas?|locales? comerciales?|dormitorios?)\b/,
  affordability: /\b(?:financ\w*|credit\w*|hipotec\w*|presupuesto|entrada|cuota|alcanz\w*|pichincha|jep)\b/,
  parking: /\b(?:parqueaderos?|estacionamientos?|garajes?|aparcamientos?|vehiculos?|autos?|carros?|motos?)\b/,
  location: /\b(?:direccion|ubicacion|ricardo darquea|elena landivar|puertas del sol|cuenca|terreno|oficina)\b/,
  financing: /\b(?:financ\w*|credit\w*|hipotec\w*|pichincha|jep|entidad|entidades|banco|cooperativa|precalific\w*)\b/,
  pets: /\b(?:mascotas?|perros?|gatos?|animales?)\b/,
}

// This checks obvious omissions, not truth or style. The semantic reviewer must
// still verify that mentioning a topic actually answers it with supported facts.
export function missingCommercialTopics(reply: string, topics: readonly CommercialTurnTopic[]): CommercialTurnTopic[] {
  const m = normalized(reply)
  return topics.filter(topic => !answerEvidence[topic].test(m))
}

export function commercialCoverageIssues(reply: string, topics: readonly CommercialTurnTopic[]): string[] {
  return missingCommercialTopics(reply, topics).length ? ['ignored_question'] : []
}
