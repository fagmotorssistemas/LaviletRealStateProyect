import { object, text, type Row } from './data'
import { hasAffordabilityConcern, priceFinancingReply } from './financing'
import { commercialTurnTopics, missingCommercialTopics, type CommercialTurnTopic } from './multi-topic-turn'
import { unitPriceQuote } from './price-reply'
import { normalized } from './sdr-rules'
import { locationAnswer, locationRequestKind } from './visit-location'

const rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object)
const withoutQuestion = (value: string) => value.replace(/\s*¿[^?]+\?\s*$/, '').trim()

/** Verified answers for the independent requests in a turn, shared by the
 * commercial writer and operational routes. This does not execute any action. */
export function turnAnswerFacts(info: Row, current: string, summary: Row = {}) {
  const topics = commercialTurnTopics(current, info.historial, ['property', 'mixed'].includes(text(info.alcance_negocio)))
  const facts: Partial<Record<CommercialTurnTopic, string>> = {}
  const catalog = rows(info.catalogo)
  if (topics.includes('price')) {
    const quote = unitPriceQuote(info, current, summary)
    if (quote?.quoted) facts.price = withoutQuestion(quote.reply)
  }
  if (topics.includes('options')) {
    const options: string[] = []
    if (catalog.some(unit => unit.category === 'suite')) options.push('suites')
    const bedrooms = [...new Set(catalog.filter(unit => unit.category === 'departamento').map(unit => Number(unit.bedrooms)).filter(n => n > 0))].sort((a, b) => a - b)
    if (catalog.some(unit => unit.category === 'departamento')) options.push('departamentos' + (bedrooms.length ? ' de ' + bedrooms.join(' o ') + ' dormitorios' : ''))
    if (catalog.some(unit => unit.category === 'local')) options.push('locales comerciales')
    if (options.length) facts.options = 'Contamos con ' + (options.length > 1 ? options.slice(0, -1).join(', ') + ' y ' : '') + options.at(-1) + '.'
  }
  const finance = object(info.financiamiento)
  const partners = Array.isArray(finance.partners) ? finance.partners.map(text).filter(Boolean) : []
  if (topics.includes('affordability') && hasAffordabilityConcern(current) && partners.length) {
    facts.affordability = `Si le preocupa cómo cubrir la compra, podemos acompañarle a revisar opciones de financiamiento con ${partners.join(' o ')} según su situación.`
  }
  if (topics.includes('financing')) facts.financing = withoutQuestion(priceFinancingReply(current, { partners, current: object(finance.current) }))
  if (topics.includes('parking') && /parqueadero|parqueo|estacionamiento/.test(normalized(JSON.stringify(info.instalaciones || [])))) {
    facts.parking = 'El proyecto contempla estacionamientos. La cantidad que corresponde a la compra depende de la unidad que elija; podemos revisar ese detalle al comparar opciones.'
  }
  const location = locationRequestKind(current)
  if (location) facts.location = locationAnswer(info, location)
  return { topics, facts }
}

/** A fallback or an early financial response must not silently drop a second
 * question. Add only missing, verified facts and preserve the existing next step. */
export function completeTurnAnswer(reply: string, prepared: ReturnType<typeof turnAnswerFacts>) {
  let answer = reply.trim()
  const additions: string[] = []
  const options = prepared.facts.options
  if (options && ['suite', 'departamento', 'local'].some(category => normalized(options).includes(category) && !normalized(answer).includes(category))) additions.push(options)
  for (const topic of missingCommercialTopics(answer, prepared.topics)) {
    const fact = prepared.facts[topic]
    if (fact && !missingCommercialTopics([answer, ...additions].join(' '), [topic]).length) continue
    if (fact) additions.push(fact)
  }
  if (additions.length) {
    const closing = answer.match(/\s*¿[^?]+\?\s*$/)?.[0] || ''
    if (closing) answer = answer.slice(0, -closing.length).trim()
    answer = [answer, ...additions].filter(Boolean).join('\n\n') + closing
  }
  return { reply: answer, missing: missingCommercialTopics(answer, prepared.topics) }
}
