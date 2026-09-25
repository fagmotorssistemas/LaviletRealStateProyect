import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { catalogReferenceReply, resolveCatalogReference } from './catalog-reference'
import { appendUnitModel, unitModelDelivery } from './unit-model'
import { acceptsUnitOptions, mentionsFinancing, salesMemory } from './sales-policy'
import { commercialEngagement } from './commercial-engagement'
import { parseCommercialPrice } from '@/lib/inmobiliaria/unitPrices'
import { purchasePriceQuestion, salesSubject } from './sales-subject'
import { hasAffordabilityConcern } from './financing'
import { asksForHouse } from './product-fit'
import { unitAlternative } from './unit-alternatives'

const rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object)
export function asksUnitPrice(value: string, propertyScope = false) {
  if (!purchasePriceQuestion(value) || (!propertyScope && salesSubject(value).subject === 'vehicle')) return false
  // One WhatsApp turn can include several messages/questions. A separate question
  // about a loan, parking or fees must not erase the requested apartment price.
  const clauses = value.split(/[¿?\n;!]+|\.\s+|\s+(?:y|adem[aá]s|tambi[eé]n|pero)\s+(?=(?:cu[aá]nt|qu[eé]\b|c[oó]mo\b|d[oó]nde\b|tengo\b|hay\b|tienen\b|necesito\b|aceptan\b))/i)
  return clauses.some(clause => {
    const m = normalized(clause)
    const financeOnly = /\b(?:credito|financiamiento|hipoteca)\b/.test(m)
      && !/\b(?:suites?|departamentos?|viviendas?|locales?|inmuebles?|propiedades?|\d{3})\b/.test(m)
      && !/\b(?:no (?:quiero|necesito|deseo)|sin) (?:financiamiento|credito|hipoteca)\b/.test(m)
    return purchasePriceQuestion(clause) && !financeOnly
      && !/garant|asegur|subir|plusval|valoriz|reventa|revender|alicuota|mantenimiento|cuota|prestamo|costo del credito|\b(?:interes|tasas?|alquiler|arriendo|renta|parqueadero|bodega)\b/.test(m)
  })
}

// Preserve the stated amount; a low budget is an opportunity to offer guidance,
// never grounds to infer thousands or claim that financing is already approved.
export function statedBudget(current: string) {
  const m = current.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  const amount = m.match(/\b(?:(?:cuento con|dispongo de|tengo)(?:\s+un)?(?:\s+presupuesto)?(?:\s+aproximado)?(?:\s+de)?|mi presupuesto(?:\s+(?:es|seria))?(?:\s+de)?|presupuesto(?:\s+(?:es|seria))?(?:\s+de)?)(?:\s+solo)?\s*\$?\s*(\d(?:[\d.,]*\d)?)(?:\s*(mil|miles|k)\b)?/)
    ?? m.match(/\b(?:quiero|busco|quisiera) (?:uno|una|un local|un departamento|una suite) (?:de |entre |por |hasta )?(?:unos? |unas? |alrededor de )?\$?\s*(\d(?:[\d.,]*\d)?)(?:\s*(mil|miles|k)\b)?/)
  if (!amount) return null
  const after = m.slice((amount.index || 0) + amount[0].length)
  if (/^\s*(?:dormitorios?|habitaciones?|hijos?|personas?|anos?|metros?|m2|m²|departamentos?|locales?|suites?)\b/.test(after)) return null
  if (/^\s*[a-z]/.test(after) && !/^\s*(?:dolares|usd|para|de presupuesto|aproximadamente|y)\b/.test(after)) return null
  let value: number | null
  try { value = parseCommercialPrice(amount[1]) } catch { return null }
  return value ? value * (amount[2] ? 1000 : 1) : null
}

export function budgetOptionsReply(info:Row,current:string):string {
  const budget=statedBudget(current), policy=object(info.politica_comercial)
  const simple=current.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
  if(!/^(?:(?:quiero|busco|quisiera) (?:uno|una|un local|un departamento|una suite) (?:de |entre |por |hasta )?(?:unos? |unas? |alrededor de )?|(?:(?:cuento con|dispongo de|tengo)(?: un)?(?: presupuesto)?(?: aproximado)?(?: de)?|mi presupuesto(?: (?:es|seria))?(?: de)?|presupuesto(?: (?:es|seria))?(?: de)?)(?: solo)?\s*)\$?\s*\d(?:[\d.,]*\d)?(?:\s*(?:mil|miles|k))?(?:\s*(?:dolares|usd))?[.!]?$/.test(simple))return ''
  if(budget===null || policy.precios_autorizados!==true || /[¿?\n]|credito|financ|ingreso|cuota|entrada|metros|dormitorio|terraza|balcon|vista|piso|planta|\b(?:entre\s+\d+.*\by\b|LC[- ]?\d+)/i.test(current))return ''
  const category=text(object(info.lead).preferred_category)
  if(!['local','suite','departamento'].includes(category))return ''
  const catalog=rows(info.catalogo).filter(u=>u.category===category && u.is_published!==false && (!u.status||u.status==='disponible') && Number(u.published_commercial_price)>0)
  if(!catalog.length)return ''
  const within=catalog.filter(u=>Number(u.published_commercial_price)<=budget).sort((a,b)=>Number(b.published_commercial_price)-Number(a.published_commercial_price)).slice(0,3)
  const chosen=within.length?within:[...catalog].sort((a,b)=>Number(a.published_commercial_price)-Number(b.published_commercial_price)).slice(0,1)
  const money=(v:unknown)=>'$'+Number(v).toLocaleString('es-EC',{maximumFractionDigits:2})
  const amounts=chosen.map(u=>`${u.unit_number}: ${money(u.published_commercial_price)}`).join('; ')
  const note=policy.precios_aproximados===true?' Son precios referenciales de lanzamiento y pueden variar.':''
  if(within.length)return `Con ese presupuesto podemos concentrarnos en estas opciones: ${amounts}.${note} ¿Cuál le gustaría revisar?`
  const finance = object(info.financiamiento)
  const partners = Array.isArray(finance.partners) ? finance.partners.map(text).filter(Boolean) : []
  const label = category === 'local' ? 'locales comerciales' : category === 'suite' ? 'suites' : 'departamentos'
  return `Actualmente los ${label} parten de ${money(Number(chosen[0].published_commercial_price))}, por lo que ese presupuesto no alcanza para cubrir el valor total; la diferencia frente a la opción de menor precio es de ${money(Number(chosen[0].published_commercial_price)-budget)}.${note}${partners.length ? ' Contamos con alternativas de financiamiento, pero primero conviene identificar la unidad que le interesa.' : ''} ¿Prefiere que comparemos las opciones por planta y valor?`
}

function variant(options: string[], history: unknown) {
  const previous = rows(history).filter(row => row.role === 'bot').slice(-6).map(row => text(row.content)).join('\n')
  return options.find(option => !previous.includes(option)) || options[0]
}

const availableUnit = (unit: Row) => unit.is_published !== false && (!unit.status || unit.status === 'disponible')
const moneyValue = (unit: Row) => {
  const value = Number(unit.published_commercial_price)
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null
}
const ids = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : []

// References identify units, never their prices. Hydrate every reference from the
// current catalog, including after a summary, screenshot or semantic extraction.
function priceSelection(info: Row, current: string, summary: Row) {
  const catalog = rows(info.catalogo), m = normalized(current)
  const reference = object(info.referencia_unidad)
  const propertyContext = object(info.property_context || summary._property_context || reference.context)
  const resolved = resolveCatalogReference(catalog, current, summary._unit_reference, info.historial)
  const hydrate = (unitIds: unknown[]) => catalog.filter(unit => unitIds.includes(unit.id))
  const referenceUnits = hydrate(rows(reference.matches).map(unit => unit.id))
  const comparisonIds = ids(propertyContext.comparison_ids)
  const topic = salesSubject(current, info.historial)
  const semanticCategory = text(object(object(info.semantica_turno).property).category)
  const category = ['local', 'suite', 'penthouse', 'departamento'].includes(semanticCategory) ? semanticCategory
    : /\blocal(?:es)?\b/.test(m) ? 'local' : /\bsuites?\b/.test(m) ? 'suite'
    : /\bpenthouses?\b/.test(m) ? 'penthouse' : /\bdepart[ae]?mentos?\b/.test(m) ? 'departamento'
    : /\bviviendas?\b/.test(m) || topic.acceptedRedirect ? 'vivienda' : ''
  const matchesCategory = (unit: Row, value: string) => value === 'vivienda' ? ['suite', 'departamento', 'penthouse'].includes(text(unit.category)) : unit.category === value
  const bedroomWords: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }
  const bedroomMatch = m.match(/\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:dormitorios?|habitaciones?|cuartos?)\b/)
  const bedrooms = bedroomMatch ? Number(bedroomWords[bedroomMatch[1]] || bedroomMatch[1]) : 0
  const explicit = reference.hasUnitMention === true || resolved.hasUnitMention
  const offeredIds = ids(propertyContext.offered_ids)
  let selected: Row[], contextual = false, offeredRange = false
  // A category explicitly requested in this turn supersedes remembered units.
  // Literal unit codes still take precedence (including ambiguous codes).
  if (category && !resolved.hasUnitMention) {
    selected = catalog.filter(unit => matchesCategory(unit, category) && (!bedrooms || Number(unit.bedrooms) === bedrooms))
  } else if (!explicit && !bedrooms && !comparisonIds.length && !ids(propertyContext.selected_ids).length
    && !ids(propertyContext.focused_ids).length && offeredIds.length && asksUnitPrice(current, true)
    && !/\b(?:ese|esa|aquel|aquella)\b/.test(m)) {
    selected = hydrate(offeredIds); contextual = true; offeredRange = true
    if (selected.length !== new Set(offeredIds).size) return { selected: [], category, bedrooms, explicit, contextual, needsClarification: true }
  } else if (reference.needsClarification === true) return { selected: [], category, bedrooms, explicit, contextual, needsClarification: true }
  else if (text(reference.reason) && (referenceUnits.length || explicit)) {
    selected = referenceUnits; contextual = true
  } else if (resolved.hasUnitMention) {
    selected = resolved.matches; contextual = true
  } else if (category || bedrooms) {
    selected = catalog.filter(unit => (!category || matchesCategory(unit, category)) && (!bedrooms || Number(unit.bedrooms) === bedrooms))
  } else if (referenceUnits.length) {
    selected = referenceUnits; contextual = true
  } else if (comparisonIds.length) {
    selected = hydrate(comparisonIds); contextual = true
    // A missing member must not silently turn a comparison into another quote.
    if (selected.length !== new Set(comparisonIds).size) return { selected: [], category, bedrooms, explicit, contextual, needsClarification: true }
  } else if (ids(propertyContext.selected_ids).length) {
    selected = hydrate(ids(propertyContext.selected_ids)); contextual = true
  } else if (resolved.matches.length && (!topic.category || resolved.matches.every(unit => matchesCategory(unit, topic.category!)))) {
    selected = resolved.matches; contextual = true
  } else {
    const savedIds = ids(object(summary._unit_reference).ids)
    // Legacy summaries may mix offered options and selected units. Once the new
    // property context exists, only its explicit selection/comparison is reusable.
    const remembered = Object.keys(propertyContext).length ? [] : hydrate(savedIds)
      .filter(unit => !topic.category || matchesCategory(unit, topic.category))
    const preferred = topic.category || text(object(info.lead).preferred_category)
    const preferredBedrooms = preferred === 'local' ? 0 : Number(object(info.lead).preferred_bedrooms)
    selected = remembered.length ? remembered : preferred ? catalog.filter(unit => matchesCategory(unit, preferred) && (!preferredBedrooms || Number(unit.bedrooms) === preferredBedrooms)) : []
  }
  return { selected, category, bedrooms, explicit, contextual, offeredRange, needsClarification: false }
}

function comparisonFacts(units: Row[], contextual: boolean) {
  if (!contextual || units.length !== 2 || units.some(unit => !availableUnit(unit) || moneyValue(unit) === null)) return null
  const [first, second] = units.map(unit => moneyValue(unit)!)
  return { ids: units.map(unit => text(unit.id)), difference: Math.abs(Math.round(first * 100) - Math.round(second * 100)) / 100 }
}

// Price facts always come from this turn's authorized catalog. A media reference or
// conversation summary identifies a unit but never authorizes disclosing its price.
type PriceQuote = { reply: string; quoted: boolean; needsAdvisor?: boolean; financingOffer?: string; units?: Row[]; prices?: number[]; ranges?: { category: string; bedrooms: number; min: number; max: number; complete: boolean }[]; comparison?: { ids: string[]; difference: number } }
export function unitPriceQuote(info: Row, current: string, summary: Row): PriceQuote | null {
  if (asksForHouse(current)) return null
  if (!asksUnitPrice(current, ['property', 'mixed'].includes(text(info.alcance_negocio)))) return null
  const policy = object(info.politica_comercial), m = normalized(current)
  if (policy.precios_autorizados !== true) return {
    reply: '', quoted: false, needsAdvisor: true,
  }
  const catalog = rows(info.catalogo).filter(availableUnit)
  const selection = priceSelection(info, current, summary)
  if (selection.needsClarification) return null
  const { category, bedrooms, explicit, contextual } = selection
  const selected = selection.selected.filter(availableUnit)
  if (!selected.length && !category && !bedrooms && !explicit && !selection.selected.length) return { reply: '¿De qué suite, departamento o local le gustaría conocer el precio?', quoted: false }
  if (!selected.length && bedrooms && !explicit) {
    const recommendation=unitAlternative(info,current,statedBudget(current))
    if(recommendation)return {reply:recommendation.reply,quoted:false}
    const alternatives = [...new Set(catalog.filter(unit => category ? category === 'vivienda' ? ['suite', 'departamento', 'penthouse'].includes(text(unit.category)) : unit.category === category : ['suite', 'departamento', 'penthouse'].includes(text(unit.category))).map(unit => Number(unit.bedrooms)).filter(value => value > 0))].sort((a, b) => a - b)
    if (alternatives.length) return { reply: `No encuentro opciones de ${bedrooms} dormitorios en nuestro catálogo disponible. Tenemos opciones de ${alternatives.join(' o ')} dormitorios. ¿Le gustaría revisar alguna de ellas?`, quoted: false }
  }
  const priced = selected.filter(unit => moneyValue(unit) !== null)
  if (!priced.length) return { reply: '', quoted: false, needsAdvisor: true }
  const money = (value: unknown) => '$' + Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 })
  const unitName = (unit: Row) => `${unit.category === 'local' ? 'local' : unit.category === 'suite' ? 'suite' : unit.category === 'penthouse' ? 'penthouse' : 'departamento'} ${text(unit.unit_number)}`
  const approximate = policy.precios_aproximados === true
  const ranges = selection.offeredRange && selected.length > 1 ? [...new Set(selected.map(u => `${u.category}:${Number(u.bedrooms) || 0}`))].map(key => {
    const group = selected.filter(u => `${u.category}:${Number(u.bedrooms) || 0}` === key)
    const values = group.map(moneyValue).filter((v): v is number => v !== null)
    return { category: text(group[0].category), bedrooms: Number(group[0].bedrooms) || 0,
      min: Math.min(...values), max: Math.max(...values), complete: values.length === group.length }
  }).filter(r => Number.isFinite(r.min)) : undefined
  let reply: string
  if (ranges?.length) {
    reply = 'De las opciones que acabamos de revisar: ' + ranges.map(r => {
      const label = ({ departamento: 'departamentos', penthouse: 'penthouses', suite: 'suites', local: 'locales' } as Record<string, string>)[r.category] || r.category
      return `${label}${r.bedrooms ? ` de ${r.bedrooms} dormitorios` : ''}${r.complete ? '' : ' con precio publicado'}: ${r.min === r.max ? money(r.min) : `desde ${money(r.min)} hasta ${money(r.max)}`} USD`
    }).join('; ') + '.'
  } else if (priced.length === 1) {
    const name = `${priced[0].category === 'suite' ? 'la' : 'el'} ${unitName(priced[0])}`
    const value = money(priced[0].published_commercial_price)
    reply = variant([
      `El precio${approximate ? ' aproximado' : ''} ${priced[0].category === 'suite' ? 'de la' : 'del'} ${unitName(priced[0])} es de ${value} USD.`,
      `Para ${name}, el valor${approximate ? ' referencial' : ''} es de ${value} USD.`,
      `${name[0].toUpperCase() + name.slice(1)} tiene un valor${approximate ? ' aproximado' : ''} de ${value} USD.`,
    ], info.historial)
  }
  else if (priced.length <= 3) reply = variant(['Le comparto los valores', 'Estas son las opciones que estamos revisando', 'Para estas opciones, los valores son'], info.historial) + `: ${priced.map(unit => `${unitName(unit)}, ${money(unit.published_commercial_price)} USD`).join('; ')}.`
  else {
    const values = priced.map(unit => Number(unit.published_commercial_price))
    const min = Math.min(...values), max = Math.max(...values)
    const leadBedrooms = Number(object(info.lead).preferred_bedrooms)
    const count = bedrooms || (!category ? leadBedrooms : 0)
    const subject = count ? `Las opciones de ${count} dormitorios` : 'Las opciones que estamos revisando'
    const intro = variant([subject, count ? `Para ${count} dormitorios, los valores` : 'Para estas opciones, los valores', 'En estas opciones, los precios'], info.historial)
    reply = `${intro} ${min === max ? `parten de ${money(min)}` : `van de ${money(min)} a ${money(max)}`} USD.`
  }
  const comparison = ranges ? null : comparisonFacts(selection.selected, contextual)
  if (comparison) reply += comparison.difference === 0 ? ' Ambas opciones tienen el mismo precio.' : ` La diferencia es de ${money(comparison.difference)} USD.`
  if (approximate) reply += ' ' + variant([
    'Son valores referenciales de lanzamiento y pueden cambiar.',
    'Por ahora son valores aproximados de lanzamiento, sujetos a cambios.',
    'Estamos en lanzamiento, por lo que estos valores son referenciales y pueden variar.',
  ], info.historial)
  if (priced.length < selected.length) reply += ' Podemos consultar también el valor de las demás opciones.'
  const budget = statedBudget(current)
  const lowBudget = hasAffordabilityConcern(current) || (budget !== null && budget < Math.min(...priced.map(unit => Number(unit.published_commercial_price))))
  if (budget !== null && priced.length > 1 && budget < Math.min(...priced.map(unit => Number(unit.published_commercial_price)))) {
    reply += ` Ese presupuesto no cubre el valor total de estas opciones. Podemos revisar alternativas de financiamiento después de identificar la unidad que más le interese.`
  }
  const finance = object(info.financiamiento)
  const memory = salesMemory(summary._sales_memory, info.historial)
  const engagement = commercialEngagement(current, info.historial, summary._sales_memory)
  let financingOffer = ''
  if (priced.length === 1 && budget !== null && lowBudget && (!engagement.passive || lowBudget) && (!memory.financing_mentioned || lowBudget) && !mentionsFinancing(current) && !/no (?:quiero|necesito|deseo).*financ|sin credito/.test(m) && !Object.keys(object(finance.current)).length) {
    const partners = Array.isArray(finance.partners) ? finance.partners.map(text).filter(Boolean) : []
    if (partners.length) financingOffer = variant(lowBudget ? [
      `Si necesita financiar la compra, podemos ayudarle a revisar opciones con ${partners.join(' o ')}.`,
      `Podemos orientarle sobre el financiamiento con ${partners.join(' o ')} y ver qué alternativa se ajusta a su situación.`,
    ] : [
      `Si le interesa financiar la compra, podemos acompañarle a revisar opciones con ${partners.join(' o ')}.`,
      `También podemos ayudarle con el financiamiento a través de ${partners.join(' o ')}.`,
      `Para el financiamiento trabajamos con ${partners.join(' o ')}; podemos orientarle durante el proceso.`,
    ], info.historial)
  }
  return { reply: reply + (financingOffer ? ' ' + financingOffer : ''), financingOffer, quoted: true, units: priced, prices: priced.map(unit => moneyValue(unit)!), ...(ranges ? { ranges } : {}), ...(comparison ? { comparison } : {}) }
}

export function acceptedPriceOption(info: Row, current: string, summary: Row) {
  const history = rows(info.historial), last = text(history.filter(row => ['bot', 'asesor'].includes(text(row.role))).at(-1)?.content)
  if (!acceptsUnitOptions(current, last)) return null
  const catalog = rows(info.catalogo)
  const named = resolveCatalogReference(catalog, last).matches
  const lastPrice = [...history].reverse().find(row => row.role === 'cliente' && asksUnitPrice(text(row.content)))
  const options = named.length ? named : lastPrice ? unitPriceQuote(info, text(lastPrice.content), summary)?.units || [] : []
  // An affirmative answer accepts reviewing options; it does not select the
  // cheapest of several units on the client's behalf.
  const unit = options.length === 1 && availableUnit(options[0]) ? options[0] : null
  if (!unit) return null
  const detail = catalogReferenceReply([unit], 'Qué ofrece')
  const model = unitModelDelivery({ explicit: true, matches: [unit] }, 'Quiero ver esta unidad', info.historial, summary._unit_models_sent)
  return { reply: appendUnitModel(detail, model), audit: { source: 'accepted_price_option', fallback: false,
    unit_reference: { ids: [unit.id], numbers: [unit.unit_number] }, ...(model ? { unit_model: model } : {}) } }
}

/** Evidence is freshly hydrated from the authorized catalogue, never from a draft. */
export function priceEvidence(quote: PriceQuote, info: Row) {
  return {
    source: 'catalogo.published_commercial_price',
    approximate: object(info.politica_comercial).precios_aproximados === true,
    units: (quote.units || []).map(unit => ({ id: unit.id, unit_number: unit.unit_number, category: unit.category, price_usd: moneyValue(unit) })),
    comparison: quote.comparison || null,
    ranges: quote.ranges || [],
  }
}

export function verifiedPriceReplyIssues(reply: string, info: Row, current: string, quote: PriceQuote): string[] {
  const issues = priceReplyIssues(reply, info, current, quote.prices).filter(issue => issue !== 'style')
  const amounts = [...reply.matchAll(/\$\s*(\d[\d.,]*)|\b(\d[\d.,]*)\s*(?:USD|d[oó]lares)/gi)].map(match => {
    try { return parseCommercialPrice((match[1] || match[2]).replace(/[.,]$/, '')) } catch { return null }
  })
  const prices = quote.prices || []
  if (amounts.some(amount => amount === null || !prices.includes(amount) && amount !== quote.comparison?.difference)) issues.push('unsupported_fact')
  const required = quote.ranges?.length ? quote.ranges.flatMap(r => [r.min, r.max]) : (quote.units || []).length > 3 ? [Math.min(...prices), Math.max(...prices)] : prices
  if (required.some(price => !amounts.includes(price))) issues.push('verified_price_omitted')
  // A known amount attached to the wrong property is still an incorrect fact.
  const mentions = [...reply.matchAll(/\b(suite|departamento|penthouse|local)\s+(?:n[úu]mero\s+)?(LC[- ]?\d+|\d{1,4})\b/gi)]
  for (let index = 0; index < mentions.length; index++) {
    const mention = mentions[index]
    const unit = quote.units?.find(unit => normalized(text(unit.category)) === normalized(mention[1]) && normalized(text(unit.unit_number)) === normalized(mention[2]))
    if (!unit) { issues.push('price_unit_outside_query'); continue }
    const clause = reply.slice((mention.index || 0) + mention[0].length, mentions[index + 1]?.index).split(/[;\n]|(?<=[.!?])\s/)[0]
    for (const amount of clause.matchAll(/\$\s*(\d[\d.,]*)|\b(\d[\d.,]*)\s*(?:USD|d[oó]lares)/gi)) {
      try {
        if (parseCommercialPrice((amount[1] || amount[2]).replace(/[.,]$/, '')) !== moneyValue(unit)) issues.push('price_unit_mismatch')
      } catch { issues.push('unsupported_fact') }
    }
  }
  return [...new Set(issues)]
}

export const PRICE_REPLY_RULES = `La política comercial de este turno prevalece sobre el historial y cualquier guion anterior.
Solo informe precios de catálogo autorizados: nunca reutilice un precio recordado si ahora está oculto.
En Lanzamiento, si precios_aproximados es true, identifique el valor como aproximado y explique brevemente que es referencial de lanzamiento y puede cambiar.
En Preventa informe el precio sin esa aclaración. No invente descuentos, precios, cuotas ni notificaciones futuras.
Si hay respuesta_precio_verificada, incluya esos datos y resuelva también las otras consultas; no vuelva a pedir la unidad ya identificada.
Si se comparan unidades concretas y el cliente pregunta «¿y en precio?», conserve esa comparación: informe cada precio verificado y la diferencia calculada. No sustituya las unidades por el rango de toda una categoría. Un importe calculado como diferencia no es el precio de ninguna unidad.
Hable al cliente con naturalidad. Nunca diga «precio registrado», «precio autorizado», «registrado en el sistema» ni explique cómo almacenamos los precios. Diga el valor o el rango de las opciones de su interés.
Si el cliente dice «tengo 100 dólares» o un presupuesto inferior al precio, puede ofrecer orientación sobre financiamiento sin interrogarlo por la cifra. Respete el monto literal: no lo multiplique por mil ni asegure que alcanza para una entrada o que se aprobará un crédito.
No repita ofertas de financiamiento ya mencionadas. No añada por rutina «la aprobación depende de la entidad» ni «la entidad evalúa cada solicitud»; ofrezca acompañamiento en el proceso.
Si le preguntan expresamente si el crédito está aprobado o garantizado, explique que la entidad debe evaluar el caso; nunca asegure una aprobación.`

export function priceReplyIssues(reply: string, info: Row, current = '', expectedPrices?: number[]) {
  const policy = object(info.politica_comercial), m = normalized(reply)
  const styleIssues = /precios?[^.!?\n]{0,35}(?:registrad|autorizad)|(?:registrad|autorizad)[^.!?\n]{0,25}precios?/.test(m)
    || !/aprob|garanti|asegur/.test(normalized(current)) && /aprobacion depende|entidad evalua cada solicitud/.test(m)
  const discloses = /(?:\$\s*\d|\d[\d.,]*\s*(?:USD|d[oó]lares))/i.test(reply) && /precio|valor|cuesta|costo|desde|opciones/.test(m)
  if (!discloses) return styleIssues ? ['style'] : []
  const disclosureRequested = asksUnitPrice(current, true) || statedBudget(current) !== null || hasAffordabilityConcern(current)
    || /\bno (?:se|estoy segur[oa]|tengo claro|tengo idea)\b.*\b(?:presupuesto|dinero|invertir|gastar|pagar)\b/.test(normalized(current))
    || /\b(?:me interesa|prefiero|elijo|escojo|me quedo con|quiero|quisiera)\b.*\b(?:suite|departamento|local|unidad)\s*(?:numero\s*)?\d{1,4}\b/.test(normalized(current))
  if (policy.precios_autorizados !== true) return ['unsupported_fact']
  if (/€|£|\b(?:EUR|GBP|euros|libras esterlinas)\b/i.test(reply)) return ['unsupported_fact']
  const selection = priceSelection(info, current, {})
  const comparison = comparisonFacts(selection.selected, selection.contextual)
  const allowed = expectedPrices || selection.selected
    .filter(availableUnit).map(moneyValue).filter((value): value is number => value !== null)
  for (const match of reply.matchAll(/\$\s*(\d[\d.,]*)|\b(\d[\d.,]*)\s*(?:USD|d[oó]lares)/gi)) {
    try {
      const amount = parseCommercialPrice((match[1] || match[2]).replace(/[.,]$/, '')) || 0
      const before = normalized(reply.slice(0, match.index).split(/[.!?;\n]/).at(-1) || '')
      const after = normalized(reply.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 45))
      const differenceLabel = /\bdiferencia\b[^.!?;\n]{0,80}$/.test(before) || /^(?:usd|dolares)?\s*(?:mas|menos)\b/.test(after)
      if (differenceLabel) {
        if (!comparison || comparison.difference !== amount) return ['unsupported_fact']
      } else if (!allowed.includes(amount)) return ['unsupported_fact']
    }
    catch { return ['unsupported_fact'] }
  }
  if (policy.precios_aproximados === true && (!/aproximad|referencial/.test(m) || !/lanzamiento/.test(m) || !/pueden? (?:cambiar|variar)|sujet[oa]s? a cambios/.test(m))) return ['unsupported_fact']
  if (info.modo_comercial === 'preventa' && /(?:precio|valor)[^.]*aproximad|referencial de lanzamiento/.test(m)) return ['unsupported_fact']
  return styleIssues || current.trim() && !disclosureRequested ? ['style'] : []
}
