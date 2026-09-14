import { normalized } from './sdr-rules'
import { mentionsOwnedVehicle, purchasePriceQuestion, salesSubject } from './sales-subject'
import { hasAffordabilityConcern } from './financing'
import { locationRequestKind } from './visit-location'

export type CommercialTurnTopic = 'price' | 'options' | 'affordability' | 'parking' | 'location' | 'financing' | 'pets'

// A coverage checklist for the whole buffered customer turn. It supplies no
// property facts and authorizes no action; scope and verified context still own
// those decisions. A finance shortcut can use it to preserve unrelated questions.
export function commercialTurnTopics(current: string, history: unknown = [], propertyScope = false): CommercialTurnTopic[] {
  const m = normalized(current)
  if (!propertyScope && salesSubject(current, history).subject === 'vehicle') return []
  const topics: CommercialTurnTopic[] = []
  if (purchasePriceQuestion(current)) topics.push('price')
  const asksOptions = /\b(?:que|cuales) (?:otras? )?(?:opciones|alternativas)|\bque (?:tienen|ofrecen|venden|puedo comprar)\b|\b(?:muestr[ae]me|ver) (?:las |sus |otras? )?opciones\b/.test(m)
  const namesProperty = /\b(?:suites?|departamentos?|viviendas?|locales?|inmuebles?)\b/.test(m)
  const namesOtherOptions = /\b(?:horarios?|citas?|visitas?|manana|lunes|martes|miercoles|jueves|viernes|sabado|financ\w*|credit\w*|hipotec\w*|jep|pichincha)\b/.test(m)
  if (asksOptions && (namesProperty || !namesOtherOptions)) topics.push('options')
  if (hasAffordabilityConcern(current)) topics.push('affordability')
  if (/\b(?:parqueaderos?|estacionamientos?|garajes?|aparcamientos?)\b/.test(m) || mentionsOwnedVehicle(current)) topics.push('parking')
  if (locationRequestKind(current)) topics.push('location')
  const financialQuestions = m.replace(/\b(?:no (?:quiero|deseo|necesito|me interesa|nos interesa)|sin) (?:el |un |ningun |mas )?(?:financ\w*|credit\w*|hipotec\w*)(?: directo| bancario)?(?: con (?:banco |cooperativa )?(?:pichincha|jep))?/g, '')
  if (/\b(?:financ\w*|credit\w*|hipotec\w*|pichincha|jep|elegible|precalific\w*)\b/.test(financialQuestions)) topics.push('financing')
  if (/\b(?:mascotas?|perros?|gatos?)\b/.test(m)) topics.push('pets')
  return topics
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
