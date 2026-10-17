import { replaceBedroomComparison } from './bedroom-comparison'
import { catalogQuery,filterCatalog } from './catalog-dialogue'
import { catalogReferenceReply,resolveCatalogReference } from './catalog-reference'
import { commercialEngagement } from './commercial-engagement'
import { object,text,type Row } from './data'
import { hasAffordabilityConcern } from './financing'
import { LAUNCH_PRICE_COMPARISON_RULE } from './launch-price-policy'
import { REFERENTIAL_PRICE_NOTICE_RULES,referentialPriceNoticeRequired } from './price-conditions'
import { asksForHouse } from './product-fit'
import { acceptsUnitOptions,mentionsFinancing,salesMemory } from './sales-policy'
import { purchasePriceQuestion,salesSubject } from './sales-subject'
import { normalized } from './sdr-rules'
import { propertyFiltersWithQuantityMeaning } from './turn-semantics'
import { appendUnitModel,unitModelDelivery } from './unit-model'

const rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object)
export function asksUnitPrice(value: string, _propertyScope = false, interpreted: unknown = {}) { void _propertyScope;
  return purchasePriceQuestion(value, interpreted)
}

export function statedBudget(_current: string, interpreted: unknown = {}): number | null {
  const row = object(interpreted), semantics = object(row.semantica_turno || row.turn_semantics || row), budget = object(semantics.budget)
  return budget.subject === 'total_budget' && typeof budget.amount === 'number' && Number.isFinite(budget.amount)
    && budget.amount > 0 && ['high','medium'].includes(text(budget.confidence)) ? budget.amount : null
}

export function budgetOptionsReply(info:Row,current:string):string {
  const budget=statedBudget(current, info), policy=object(info.politica_comercial)
  if(budget===null || policy.precios_autorizados!==true || object(info.contrato_turno).objective !== 'discuss_budget')return ''
  const category=text(object(info.lead).preferred_category)
  if(!['local','suite','departamento'].includes(category))return ''
  const catalog=rows(info.catalogo).filter(u=>u.category===category && u.is_published!==false && (!u.status||u.status==='disponible') && Number(u.published_commercial_price)>0)
  if(!catalog.length)return ''
  const within=catalog.filter(u=>Number(u.published_commercial_price)<=budget).sort((a,b)=>Number(b.published_commercial_price)-Number(a.published_commercial_price)).slice(0,3)
  const chosen=within.length?within:[...catalog].sort((a,b)=>Number(a.published_commercial_price)-Number(b.published_commercial_price)).slice(0,1)
  const money=(v:unknown)=>'$'+Number(v).toLocaleString('es-EC',{maximumFractionDigits:2})
  const amounts=chosen.map(u=>`${u.unit_number}: ${money(u.published_commercial_price)}`).join('; ')
  const note=referentialPriceNoticeRequired(policy)?' Son precios referenciales vigentes y pueden variar.':''
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

// A category-only clarification can complete an earlier price question. Consume
// the reconciled turn contract without rewriting the client's actual message.
function currentPriceGoal(info: Row, current: string) {
  return object(info.contrato_turno).objective === 'ask_price' || asksUnitPrice(current, true, info)
}

// References identify units, never their prices. Hydrate every reference from the
// current catalog, including after a summary, screenshot or semantic extraction.
function priceSelection(info: Row, current: string, summary: Row) {
  const catalog = rows(info.catalogo)
  const reference = object(info.referencia_unidad)
  const propertyContext = object(info.property_context || summary._property_context || reference.context)
  const resolved = resolveCatalogReference(catalog, current, summary._unit_reference, info.historial, info.semantica_turno)
  const hydrate = (unitIds: unknown[]) => catalog.filter(unit => unitIds.includes(unit.id))
  const referenceUnits = hydrate(rows(reference.matches).map(unit => unit.id))
  const comparisonIds = ids(propertyContext.comparison_ids)
  const topic = salesSubject(current, info.historial, info)
  const semanticProperty = object(object(info.semantica_turno).property)
  const semanticCategory = text(semanticProperty.category)
  const literalCategory = semanticCategory || (semanticProperty.group === 'residential' ? 'vivienda' : '')
  const category = ['local', 'suite', 'penthouse', 'departamento'].includes(semanticCategory) ? semanticCategory : literalCategory
  const matchesCategory = (unit: Row, value: string) => value === 'vivienda' ? ['suite', 'departamento', 'penthouse'].includes(text(unit.category)) : unit.category === value
  const sharedQuery = object(reference.query || propertyContext.query)
  const resolvedQuery = Object.keys(object(reference.query)).length > 0
  // A fresh, explicit category price question defines a new scope. A short
  // clarification instead retains the interpreter's normalized query filters.
  const freshCategoryQuery = !resolvedQuery && !!literalCategory && asksUnitPrice(current, true, info)
  const semanticFilters = propertyFiltersWithQuantityMeaning(object(semanticProperty.filters), info.semantica_turno)
  const filters = replaceBedroomComparison({ ...(freshCategoryQuery ? {} : object(sharedQuery.filters)),
    ...Object.fromEntries(Object.entries(semanticFilters).filter(([, value]) => value !== null && value !== undefined)) }, semanticFilters)
  if (semanticFilters.bedrooms != null && !(Array.isArray(semanticFilters.bedrooms_any) && semanticFilters.bedrooms_any.length > 1)) delete filters.bedrooms_any
  else if (Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length > 1) filters.bedrooms = null
  const query = catalogQuery(resolvedQuery ? reference.query : { ...sharedQuery,
    category: category === 'vivienda' ? null : category || sharedQuery.category,
    group: category === 'vivienda' ? 'residential' : category ? category === 'local' ? 'commercial' : 'residential' : semanticProperty.group || sharedQuery.group,
    scope: freshCategoryQuery ? 'catalog' : semanticProperty.query_scope || sharedQuery.scope, filters })
  const hasFilters = Object.entries(query.filters).some(([key, value]) => key !== 'bedrooms_required' && value !== null && (!Array.isArray(value) || value.length > 0))
  const bedrooms = query.filters.bedrooms || 0
  const explicit = resolvedQuery ? reference.explicit === true : reference.hasUnitMention === true || resolved.hasUnitMention
  const offeredIds = ids(propertyContext.offered_ids)
  const queryScopeIds = query.scope === 'offered' ? offeredIds : query.scope === 'comparison' ? comparisonIds
    : query.scope === 'selected' ? ids(propertyContext.selected_ids) : undefined
  const excluded = ids(semanticProperty.excluded_categories)
  const queryUnits = () => filterCatalog(catalog.filter(unit => ['suite', 'departamento', 'penthouse', 'local'].includes(text(unit.category))
    && !excluded.includes(text(unit.category))), query, queryScopeIds)
  let selected: Row[], contextual = false, offeredRange = false, generalRange = false, filteredQuery = false
  // A category explicitly requested in this turn supersedes remembered units.
  // Literal unit codes still take precedence (including ambiguous codes).
  if (hasFilters && !explicit) {
    selected = queryUnits(); filteredQuery = true
  } else if (category && !explicit) {
    selected = queryUnits()
    if (category === 'vivienda' && !hasFilters) generalRange = true
  } else if (!explicit && !bedrooms && !comparisonIds.length && !ids(propertyContext.selected_ids).length
    && !ids(propertyContext.focused_ids).length && offeredIds.length && asksUnitPrice(current, true, info)
    && semanticProperty.query_scope === 'offered') {
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
    if (!selected.length && !remembered.length && !preferred && !savedIds.length
      && !ids(propertyContext.selected_ids).length && !ids(propertyContext.focused_ids).length
      && ['property', 'mixed'].includes(text(info.alcance_negocio))) {
      const property = object(object(info.semantica_turno).property)
      const excluded = ids(property.excluded_categories)
      selected = catalog.filter(unit => ['suite', 'departamento', 'penthouse', 'local'].includes(text(unit.category))
        && !excluded.includes(text(unit.category))
        && (property.group !== 'residential' || unit.category !== 'local')
        && (property.group !== 'commercial' || unit.category === 'local'))
      generalRange = true
    }
  }
  const constrainedBeyondBedrooms = query.filters.floor_number !== null || query.filters.min_area_m2 !== null || query.filters.max_area_m2 !== null || !!query.filters.bedrooms_any?.length
  return { selected, category, bedrooms, explicit, contextual, offeredRange, generalRange, filteredQuery, constrainedBeyondBedrooms, needsClarification: false }
}

function comparisonFacts(units: Row[], contextual: boolean) {
  if (!contextual || units.length !== 2 || units.some(unit => !availableUnit(unit) || moneyValue(unit) === null)) return null
  const [first, second] = units.map(unit => moneyValue(unit)!)
  return { ids: units.map(unit => text(unit.id)), difference: Math.abs(Math.round(first * 100) - Math.round(second * 100)) / 100 }
}

const quotedOptionsQuestion = '¿Le gustaría obtener más detalles de alguna de estas opciones?'
const joinOptions = (values: string[]) => values.length < 2 ? values[0] || '' : `${values.slice(0, -1).join(', ')} y ${values.at(-1)}`

function sharedQuoteFloor(units: Row[]) {
  const labels = units.map(unit => text(unit.floor).trim())
  if (labels.every(label => label && normalized(label) === normalized(labels[0]))) return labels[0].toLocaleLowerCase('es')
  const numbers = units.map(unit => unit.floor_number === null || unit.floor_number === undefined || unit.floor_number === '' ? null : Number(unit.floor_number))
  if (!numbers.every(value => value !== null && Number.isFinite(value) && value === numbers[0])) return ''
  // A floor number is enough to state its number, but not to invent the
  // building's named floor (for example, "sexta planta alta").
  return `planta ${numbers[0]}`
}

function focusedPriceDescription(units: Row[], approximate: boolean, history: unknown, showNotice: boolean) {
  const category = text(units[0].category), feminine = category === 'suite'
  const label = ({ departamento: 'departamentos', penthouse: 'penthouses', suite: 'suites', local: 'locales comerciales' } as Record<string, string>)[category]
  const bedrooms = [...new Set(units.map(unit => Number(unit.bedrooms)))].sort((a, b) => a - b)
  const bedroomLabel = category !== 'local' && bedrooms.every(value => Number.isInteger(value) && value > 0)
    ? ` de ${joinOptions(bedrooms.map(String))} ${bedrooms.length === 1 && bedrooms[0] === 1 ? 'dormitorio' : 'dormitorios'}` : ''
  const subject = `${feminine ? 'Las' : 'Los'} ${label}${bedroomLabel}`
  const floor = sharedQuoteFloor(units)
  const floorPhrase = floor ? `ubicad${feminine ? 'as' : 'os'} en ${/^la\s/i.test(floor) ? '' : 'la '}${floor}` : ''
  const money = (value: number) => '$' + value.toLocaleString('es-EC', { maximumFractionDigits: 2 })
  const values = units.map(unit => moneyValue(unit)!), minimum = Math.min(...values), maximum = Math.max(...values)
  const numbers = units.map(unit => text(unit.unit_number))
  const compactNamedSet = units.length <= 3 && numbers.every(Boolean)
  const namedSubject = compactNamedSet ? `${subject} son ${joinOptions(numbers.map(number => `${feminine ? 'la' : 'el'} ${number}`))}` : subject
  const location = floorPhrase ? compactNamedSet ? `, ${units.length === 2 ? feminine ? 'ambas' : 'ambos' : feminine ? 'todas' : 'todos'} ${floorPhrase}` : ` están ${floorPhrase}` : ''
  const referentialQualifier = approximate ? variant([' referencial vigente', ' de referencia vigente', ' orientativo vigente'], history) : ''
  const priceNotice = showNotice ? ' ' + variant(['Son valores referenciales vigentes y pueden cambiar.',
    'Por ahora son valores referenciales vigentes, sujetos a cambios.',
    'Estos valores son referenciales vigentes y pueden variar.'], history) : ''
  if (minimum === maximum) {
    const prefix = compactNamedSet || floorPhrase ? `${namedSubject}${location}, con un valor` : `${subject} tienen un valor`
    return `${prefix}${referentialQualifier} de ${money(minimum)} USD cada un${feminine ? 'a' : 'o'}${showNotice ? ', sujeto a cambios' : ''}.`
  }
  const introduction = compactNamedSet || floorPhrase ? `${namedSubject}${location}. ` : ''
  if (compactNamedSet) return introduction + units.map(unit => `El precio ${feminine ? 'de la suite' : `del ${category}`} ${text(unit.unit_number)} es de ${money(moneyValue(unit)!)} USD.`).join(' ')
    + priceNotice
  return `${introduction}${introduction ? 'Sus valores van' : `${subject} tienen valores que van`} desde ${money(minimum)} hasta ${money(maximum)} USD.${priceNotice}`
}

// Price facts always come from this turn's authorized catalog. A media reference or
// conversation summary identifies a unit but never authorizes disclosing its price.
type PriceQuote = { reply: string; quoted: boolean; needsAdvisor?: boolean; financingOffer?: string; units?: Row[]; prices?: number[]; ranges?: { category: string; bedrooms: number; min: number; max: number; complete: boolean }[]; comparison?: { ids: string[]; difference: number }; followUp?: { question: string; purpose: 'explore_quoted_options'; candidate_ids: string[]; category: string; bedrooms: number | null } }
export function unitPriceQuote(info: Row, current: string, summary: Row): PriceQuote | null {
  if (info.alcance_negocio === 'out_of_scope' || object(object(info.contrato_turno).scope).kind === 'out_of_scope') return null
  if (asksForHouse(current, info)) return null
  if (!currentPriceGoal(info, current)) return null
  const policy = object(info.politica_comercial)
  if (policy.precios_autorizados !== true) return {
    reply: '', quoted: false, needsAdvisor: true,
  }
  const catalog = rows(info.catalogo).filter(availableUnit)
  const selection = priceSelection(info, current, summary)
  if (selection.needsClarification) return null
  const { category, bedrooms, explicit, contextual } = selection
  const selected = selection.selected.filter(availableUnit)
  if (!selected.length && selection.filteredQuery && (!bedrooms || selection.constrainedBeyondBedrooms)) return {
    reply: 'No encuentro inmuebles disponibles que coincidan con esas características para cotizarle. ¿Le gustaría revisar otras opciones?', quoted: false,
  }
  if (!selected.length && !category && !bedrooms && !explicit && !selection.selected.length) return {
    reply: selection.generalRange ? 'No tengo un rango de precios disponible para compartirle en este momento. ¿De qué tipo de inmueble le gustaría consultar el valor?' : '¿De qué suite, departamento o local le gustaría conocer el precio?', quoted: false,
  }
  if (!selected.length && bedrooms && !explicit) {
    const alternatives = [...new Set(catalog.filter(unit => category ? category === 'vivienda' ? ['suite', 'departamento', 'penthouse'].includes(text(unit.category)) : unit.category === category : ['suite', 'departamento', 'penthouse'].includes(text(unit.category))).map(unit => Number(unit.bedrooms)).filter(value => value > 0))].sort((a, b) => a - b)
    if (alternatives.length) return { reply: `No encuentro opciones de ${bedrooms} dormitorios en nuestro catálogo disponible. Tenemos opciones de ${alternatives.join(' o ')} dormitorios. ¿Le gustaría revisar alguna de ellas?`, quoted: false }
  }
  const priced = selected.filter(unit => moneyValue(unit) !== null)
  if (!priced.length) return selection.generalRange
    ? { reply: 'No tengo un rango de precios disponible para compartirle en este momento. ¿De qué tipo de inmueble le gustaría consultar el valor?', quoted: false }
    : { reply: '', quoted: false, needsAdvisor: true }
  const money = (value: unknown) => '$' + Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 })
  const unitName = (unit: Row) => `${unit.category === 'local' ? 'local' : unit.category === 'suite' ? 'suite' : unit.category === 'penthouse' ? 'penthouse' : 'departamento'} ${text(unit.unit_number)}`
  const approximate = policy.precios_aproximados === true
  const ranges = selection.generalRange ? [{ category: 'inmueble', bedrooms: 0,
    min: Math.min(...priced.map(unit => moneyValue(unit)!)), max: Math.max(...priced.map(unit => moneyValue(unit)!)), complete: priced.length === selected.length }]
    : selection.offeredRange && selected.length > 1 ? [...new Set(selected.map(u => `${u.category}:${Number(u.bedrooms) || 0}`))].map(key => {
    const group = selected.filter(u => `${u.category}:${Number(u.bedrooms) || 0}` === key)
    const values = group.map(moneyValue).filter((v): v is number => v !== null)
    return { category: text(group[0].category), bedrooms: Number(group[0].bedrooms) || 0,
      min: Math.min(...values), max: Math.max(...values), complete: values.length === group.length }
  }).filter(r => Number.isFinite(r.min)) : undefined
  const comparison = ranges ? null : comparisonFacts(selection.selected, contextual)
  // Explain the current interest, not the rest of the inventory. A quote for
  // several options is an invitation to explore, never an implicit selection.
  const focused = !selection.generalRange && !explicit && !comparison && priced.length > 1 && priced.length === selected.length
    && priced.every(unit => unit.category === priced[0].category)
  const commonBedrooms = focused && priced.every(unit => Number(unit.bedrooms) > 0 && Number(unit.bedrooms) === Number(priced[0].bedrooms)) ? Number(priced[0].bedrooms) : null
  const followUp = focused ? { question: quotedOptionsQuestion, purpose: 'explore_quoted_options' as const,
    candidate_ids: priced.map(unit => text(unit.id)), category: text(priced[0].category), bedrooms: commonBedrooms } : undefined
  let reply: string
  if (focused) reply = focusedPriceDescription(priced, approximate, info.historial, referentialPriceNoticeRequired(policy))
  else if (selection.generalRange && ranges?.length) {
    const range = ranges[0]
    reply = `Los precios de los inmuebles disponibles${range.complete ? '' : ' con precio publicado'} ${range.min === range.max ? `parten de ${money(range.min)}` : `van desde ${money(range.min)} hasta ${money(range.max)}`} USD, según el tipo de inmueble y la unidad.`
  } else if (ranges?.length) {
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
  if (comparison) reply += comparison.difference === 0 ? ' Ambas opciones tienen el mismo precio.' : ` La diferencia es de ${money(comparison.difference)} USD.`
  if (referentialPriceNoticeRequired(policy) && !focused) reply += ' ' + variant([
    'Son valores referenciales vigentes y pueden cambiar.',
    'Por ahora son valores referenciales vigentes, sujetos a cambios.',
    'Estos valores son referenciales vigentes y pueden variar.',
  ], info.historial)
  if (priced.length < selected.length) reply += ' Podemos consultar también el valor de las demás opciones.'
  const budget = statedBudget(current, info)
  const lowBudget = hasAffordabilityConcern(current, info) || (budget !== null && budget < Math.min(...priced.map(unit => Number(unit.published_commercial_price))))
  if (budget !== null && priced.length > 1 && budget < Math.min(...priced.map(unit => Number(unit.published_commercial_price)))) {
    reply += ` Ese presupuesto no cubre el valor total de estas opciones. Podemos revisar alternativas de financiamiento después de identificar la unidad que más le interese.`
  }
  const finance = object(info.financiamiento)
  const memory = salesMemory(summary._sales_memory, info.historial)
  const engagement = commercialEngagement(current, info.historial, summary._sales_memory, { semantics: info.semantica_turno, intent: info.contrato_turno })
  let financingOffer = ''
  if (priced.length === 1 && budget !== null && lowBudget && (!engagement.passive || lowBudget) && (!memory.financing_mentioned || lowBudget) && !mentionsFinancing(current, info) && object(object(object(info.semantica_turno).action_authority).financing).decision !== 'decline' && !Object.keys(object(finance.current)).length) {
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
  return { reply: reply + (financingOffer ? ' ' + financingOffer : '') + (followUp ? ' ' + followUp.question : ''), financingOffer, quoted: true, units: priced, prices: priced.map(unit => moneyValue(unit)!), ...(ranges ? { ranges } : {}), ...(comparison ? { comparison } : {}), ...(followUp ? { followUp } : {}) }
}

export function acceptedPriceOption(info: Row, current: string, summary: Row) {
  const semantics = object(info.semantica_turno), pending = object(info.pregunta_pendiente || summary._pending_question)
  if (!acceptsUnitOptions(current, '', { semantics, pendingQuestion: pending, intent: info.contrato_turno })) return null
  const catalog = rows(info.catalogo)
  const options = catalog.filter(unit => ids(pending.candidate_ids).includes(text(unit.id)))
  // An affirmative answer accepts reviewing options; it does not select the
  // cheapest of several units on the client's behalf.
  const unit = options.length === 1 && availableUnit(options[0]) ? options[0] : null
  if (!unit) return null
  const detail = catalogReferenceReply([unit], current, { ...semantics, property: { ...object(semantics.property), operation: 'details' } })
  const model = unitModelDelivery({ explicit: true, matches: [unit] }, current, info.historial, summary._unit_models_sent, semantics)
  return { reply: appendUnitModel(detail, model), audit: { source: 'accepted_price_option', fallback: false,
    unit_reference: { ids: [unit.id], numbers: [unit.unit_number] }, ...(model ? { unit_model: model } : {}) } }
}

/** Evidence is freshly hydrated from the authorized catalogue, never from a draft. */
export function priceEvidence(quote: PriceQuote, info: Row) {
  return {
    source: 'catalogo.published_commercial_price',
    approximate: object(info.politica_comercial).precios_aproximados === true,
    units: (quote.units || []).map(unit => ({ id: unit.id, unit_number: unit.unit_number, category: unit.category,
      bedrooms: unit.bedrooms ?? null, floor: unit.floor ?? null, floor_number: unit.floor_number ?? null, price_usd: moneyValue(unit) })),
    comparison: quote.comparison || null,
    ranges: quote.ranges || [],
    follow_up: quote.followUp || null,
  }
}

/** Compatibility API: factual prose review belongs to the configured AI reviewer. */
export function verifiedPriceReplyIssues(_reply: string, _info: Row, _current = '', _evidence?: unknown): string[] { void _current; void _evidence; return [] }

export const PRICE_REPLY_RULES = `La política comercial de este turno prevalece sobre el historial y cualquier guion anterior.
Solo informe precios de catálogo autorizados: nunca reutilice un precio recordado si ahora está oculto.
${REFERENTIAL_PRICE_NOTICE_RULES}
Respete las condiciones comerciales publicadas aplicables. No invente descuentos, precios, cuotas ni notificaciones futuras.
Si hay respuesta_precio_verificada, incluya esos datos y resuelva también las otras consultas; no vuelva a pedir la unidad ya identificada.
Si la cotización reúne varias opciones del interés actual, explique qué dormitorios tienen y la planta compartida cuando esté verificada. Conserve la invitación a conocer más detalles de esas opciones. No agregue alternativas más económicas o con menos dormitorios si el cliente no las pidió. La aceptación de esa invitación no selecciona ninguna unidad; espere su elección antes de enviar un recorrido de una unidad específica.
Un rango general de inmuebles puede reunir categorías distintas: no lo presente como el precio de departamentos, suites u otra categoría específica. Si faltan precios de algunas unidades, conserve la aclaración de que el rango corresponde a las opciones con precio publicado.
Si se comparan unidades concretas y el cliente pregunta «¿y en precio?», conserve esa comparación: informe cada precio verificado y la diferencia calculada. No sustituya las unidades por el rango de toda una categoría. Un importe calculado como diferencia no es el precio de ninguna unidad.
Hable al cliente con naturalidad. Nunca diga «precio registrado», «precio autorizado», «registrado en el sistema» ni explique cómo almacenamos los precios. Diga el valor o el rango de las opciones de su interés.
Si el cliente dice «tengo 100 dólares» o un presupuesto inferior al precio, puede ofrecer orientación sobre financiamiento sin interrogarlo por la cifra. Respete el monto literal: no lo multiplique por mil ni asegure que alcanza para una entrada o que se aprobará un crédito.
No repita ofertas de financiamiento ya mencionadas. No añada por rutina «la aprobación depende de la entidad» ni «la entidad evalúa cada solicitud»; ofrezca acompañamiento en el proceso.
Si le preguntan expresamente si el crédito está aprobado o garantizado, explique que la entidad debe evaluar el caso; nunca asegure una aprobación.
${LAUNCH_PRICE_COMPARISON_RULE}`

/** Compatibility API: factual prose review belongs to the configured AI reviewer. */
export function priceReplyIssues(_reply: string, _info: Row, _current = '', _evidence?: unknown): string[] { void _current; void _evidence; return [] }
