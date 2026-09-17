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
  const amount = m.match(/\b(?:cuento con|dispongo de|tengo|presupuesto(?: es)?(?: de)?)(?:\s+solo)?\s*\$?\s*(\d(?:[\d.,]*\d)?)(?:\s*(mil|miles|k)\b)?/)
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
  if(!/^(?:(?:quiero|busco|quisiera) (?:uno|una|un local|un departamento|una suite) (?:de |entre |por |hasta )?(?:unos? |unas? |alrededor de )?|(?:cuento con|dispongo de|tengo|presupuesto(?: es)?(?: de)?)(?: solo)?\s+)\$?\s*\d(?:[\d.,]*\d)?(?:\s*(?:mil|miles|k))?(?:\s*(?:dolares|usd))?[.!]?$/.test(simple))return ''
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
  if(within.length)return `Estas opciones están dentro de ese monto: ${amounts}.${note} ¿Cuál le gustaría revisar?`
  return `La opción de menor precio del catálogo es ${amounts}; supera ese monto en ${money(Number(chosen[0].published_commercial_price)-budget)}.${note} ¿Tiene flexibilidad para considerar esa diferencia?`
}

function variant(options: string[], history: unknown) {
  const previous = rows(history).filter(row => row.role === 'bot').slice(-6).map(row => text(row.content)).join('\n')
  return options.find(option => !previous.includes(option)) || options[0]
}

// Price facts always come from this turn's authorized catalog. A media reference or
// conversation summary identifies a unit but never authorizes disclosing its price.
export function unitPriceQuote(info: Row, current: string, summary: Row) {
  if (asksForHouse(current)) return null
  if (!asksUnitPrice(current, ['property', 'mixed'].includes(text(info.alcance_negocio)))) return null
  const policy = object(info.politica_comercial), m = normalized(current)
  if (policy.precios_autorizados !== true) return {
    reply: '', quoted: false, needsAdvisor: true,
  }
  const catalog = rows(info.catalogo)
  const topic = salesSubject(current, info.historial)
  const category = /\blocal(?:es)?\b/.test(m) ? 'local' : /\bsuites?\b/.test(m) ? 'suite' : /\bdepart[ae]?mentos?\b/.test(m) ? 'departamento'
    : /\bviviendas?\b/.test(m) || topic.acceptedRedirect ? 'vivienda' : ''
  const matchesCategory = (unit: Row, value: string) => value === 'vivienda' ? ['suite', 'departamento'].includes(text(unit.category)) : unit.category === value
  const bedroomWords: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }
  const bedroomMatch = m.match(/\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:dormitorios?|habitaciones?|cuartos?)\b/)
  const bedrooms = bedroomMatch ? Number(bedroomWords[bedroomMatch[1]] || bedroomMatch[1]) : 0
  const resolved = resolveCatalogReference(catalog, current, summary._unit_reference, info.historial)
  const reference = object(info.referencia_unidad)
  const referenceIds = rows(reference.matches).map(unit => unit.id)
  const savedIds = rows(catalog).filter(unit => (Array.isArray(object(summary._unit_reference).ids) ? object(summary._unit_reference).ids as unknown[] : []).includes(unit.id)).map(unit => unit.id)
  const remembered = resolved.matches.length ? resolved.matches : catalog.filter(unit => (referenceIds.length ? referenceIds : savedIds).includes(unit.id))
  let selected: Row[]
  if (resolved.hasUnitMention || reference.hasUnitMention === true) selected = resolved.matches
  else if (category || bedrooms) selected = catalog.filter(unit => (!category || matchesCategory(unit, category)) && (!bedrooms || Number(unit.bedrooms) === bedrooms))
  else if (remembered.length && (!topic.category || remembered.every(unit => matchesCategory(unit, topic.category!)))) {
    selected = remembered
  } else {
    const preferred = topic.category || text(object(info.lead).preferred_category) || ''
    const preferredBedrooms = preferred === 'local' ? 0 : Number(object(info.lead).preferred_bedrooms)
    selected = preferred ? catalog.filter(unit => matchesCategory(unit, preferred) && (!preferredBedrooms || Number(unit.bedrooms) === preferredBedrooms)) : []
    if (!preferred) return { reply: '¿De qué suite, departamento o local le gustaría conocer el precio?', quoted: false }
  }
  if (!selected.length && bedrooms && !resolved.hasUnitMention && reference.hasUnitMention !== true) {
    const alternatives = [...new Set(catalog.filter(unit => category ? matchesCategory(unit, category) : ['suite', 'departamento'].includes(text(unit.category))).map(unit => Number(unit.bedrooms)).filter(value => value > 0))].sort((a, b) => a - b)
    if (alternatives.length) return { reply: `No encuentro opciones de ${bedrooms} dormitorios en nuestro catálogo disponible. Tenemos opciones de ${alternatives.join(' o ')} dormitorios. ¿Le gustaría revisar alguna de ellas?`, quoted: false }
  }
  const priced = selected.filter(unit => Number.isFinite(Number(unit.published_commercial_price)) && Number(unit.published_commercial_price) > 0)
  if (!priced.length) return { reply: '', quoted: false, needsAdvisor: true }
  const money = (value: unknown) => '$' + Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 })
  const unitName = (unit: Row) => `${unit.category === 'local' ? 'local' : unit.category === 'suite' ? 'suite' : 'departamento'} ${text(unit.unit_number)}`
  const approximate = policy.precios_aproximados === true
  let reply: string
  if (priced.length === 1) {
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
  if (approximate) reply += ' ' + variant([
    'Son valores referenciales de lanzamiento y pueden cambiar.',
    'Por ahora son valores aproximados de lanzamiento, sujetos a cambios.',
    'Estamos en lanzamiento, por lo que estos valores son referenciales y pueden variar.',
  ], info.historial)
  if (priced.length < selected.length) reply += ' Podemos consultar también el valor de las demás opciones.'
  const budget = statedBudget(current)
  const lowBudget = hasAffordabilityConcern(current) || (budget !== null && budget < Math.min(...priced.map(unit => Number(unit.published_commercial_price))))
  const finance = object(info.financiamiento)
  const memory = salesMemory(summary._sales_memory, info.historial)
  const engagement = commercialEngagement(current, info.historial, summary._sales_memory)
  let financingOffer = ''
  if ((!engagement.passive || lowBudget) && (!memory.financing_mentioned || lowBudget) && !mentionsFinancing(current) && !/no (?:quiero|necesito|deseo).*financ|sin credito/.test(m) && !Object.keys(object(finance.current)).length) {
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
  return { reply: reply + (financingOffer ? ' ' + financingOffer : ''), financingOffer, quoted: true, units: priced, prices: priced.map(unit => Number(unit.published_commercial_price)) }
}

export function acceptedPriceOption(info: Row, current: string, summary: Row) {
  const history = rows(info.historial), last = text(history.filter(row => ['bot', 'asesor'].includes(text(row.role))).at(-1)?.content)
  if (!acceptsUnitOptions(current, last)) return null
  const catalog = rows(info.catalogo)
  const named = resolveCatalogReference(catalog, last).matches
  const lastPrice = [...history].reverse().find(row => row.role === 'cliente' && asksUnitPrice(text(row.content)))
  const options = named.length ? named : lastPrice ? unitPriceQuote(info, text(lastPrice.content), summary)?.units || [] : []
  const unit = [...options].sort((a, b) => Number(a.published_commercial_price) - Number(b.published_commercial_price))[0]
  if (!unit) return null
  const detail = catalogReferenceReply([unit], 'Qué ofrece')
  const model = unitModelDelivery({ explicit: true, matches: [unit] }, 'Quiero ver esta unidad', info.historial, summary._unit_models_sent)
  return { reply: appendUnitModel(detail, model), audit: { source: 'accepted_price_option', fallback: false,
    unit_reference: { ids: [unit.id], numbers: [unit.unit_number] }, ...(model ? { unit_model: model } : {}) } }
}

export const PRICE_REPLY_RULES = `La política comercial de este turno prevalece sobre el historial y cualquier guion anterior.
Solo informe precios de catálogo autorizados: nunca reutilice un precio recordado si ahora está oculto.
En Lanzamiento, si precios_aproximados es true, identifique el valor como aproximado y explique brevemente que es referencial de lanzamiento y puede cambiar.
En Preventa informe el precio sin esa aclaración. No invente descuentos, precios, cuotas ni notificaciones futuras.
Si hay respuesta_precio_verificada, incluya esos datos y resuelva también las otras consultas; no vuelva a pedir la unidad ya identificada.
Hable al cliente con naturalidad. Nunca diga «precio registrado», «precio autorizado», «registrado en el sistema» ni explique cómo almacenamos los precios. Diga el valor o el rango de las opciones de su interés.
Si el cliente dice «tengo 100 dólares» o un presupuesto inferior al precio, puede ofrecer orientación sobre financiamiento sin interrogarlo por la cifra. Respete el monto literal: no lo multiplique por mil ni asegure que alcanza para una entrada o que se aprobará un crédito.
No repita ofertas de financiamiento ya mencionadas. No añada por rutina «la aprobación depende de la entidad» ni «la entidad evalúa cada solicitud»; ofrezca acompañamiento en el proceso.
Si le preguntan expresamente si el crédito está aprobado o garantizado, explique que la entidad debe evaluar el caso; nunca asegure una aprobación.`

export function priceReplyIssues(reply: string, info: Row, current = '', expectedPrices?: number[]) {
  const policy = object(info.politica_comercial), m = normalized(reply)
  if (/precios?[^.!?\n]{0,35}(?:registrad|autorizad)|(?:registrad|autorizad)[^.!?\n]{0,25}precios?/.test(m)) return ['style']
  if (!/aprob|garanti|asegur/.test(normalized(current)) && /aprobacion depende|entidad evalua cada solicitud/.test(m)) return ['style']
  const discloses = /(?:\$\s*\d|\d[\d.,]*\s*(?:USD|d[oó]lares))/i.test(reply) && /precio|valor|cuesta|costo|desde|opciones/.test(m)
  if (!discloses) return []
  if (policy.precios_autorizados !== true) return ['unsupported_fact']
  const allowed = expectedPrices || rows(info.catalogo).map(unit => Number(unit.published_commercial_price)).filter(value => value > 0)
  for (const match of reply.matchAll(/\$\s*(\d[\d.,]*)|\b(\d[\d.,]*)\s*(?:USD|d[oó]lares)/gi)) {
    try { if (!allowed.includes(parseCommercialPrice((match[1] || match[2]).replace(/[.,]$/, '')) || 0)) return ['unsupported_fact'] }
    catch { return ['unsupported_fact'] }
  }
  if (policy.precios_aproximados === true && (!/aproximad|referencial/.test(m) || !/lanzamiento/.test(m))) return ['unsupported_fact']
  if (info.modo_comercial === 'preventa' && /(?:precio|valor)[^.]*aproximad|referencial de lanzamiento/.test(m)) return ['unsupported_fact']
  return []
}
