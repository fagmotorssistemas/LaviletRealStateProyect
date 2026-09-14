import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { resolveCatalogReference } from './catalog-reference'
import { mentionsFinancing, salesMemory } from './sales-policy'
import { parseCommercialPrice } from '@/lib/inmobiliaria/unitPrices'

const rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object)
export const asksUnitPrice = (value: string) => /\b(?:precios?|valores?|cuesta|cuestan|costos?|cotizacion)\b/.test(normalized(value))
  && !/garant|asegur|subir|plusval|valoriz|reventa|revender|alicuota|mantenimiento|cuota|prestamo|costo del credito|\b(?:interes|tasas?|carro|auto|moto|alquiler|arriendo|renta|parqueadero|bodega)\b/.test(normalized(value))

// Price facts always come from this turn's authorized catalog. A media reference or
// conversation summary identifies a unit but never authorizes disclosing its price.
export function unitPriceQuote(info: Row, current: string, summary: Row) {
  if (!asksUnitPrice(current)) return null
  const policy = object(info.politica_comercial), m = normalized(current)
  if (policy.precios_autorizados !== true) return {
    reply: 'Todavía no tengo un precio autorizado para compartir. Podemos revisar con el asesor el valor de la opción que le interesa.', quoted: false,
  }
  const catalog = rows(info.catalogo)
  const category = /\blocal(?:es)?\b/.test(m) ? 'local' : /\bsuites?\b/.test(m) ? 'suite' : /\bdepart[ae]mentos?\b/.test(m) ? 'departamento' : ''
  const bedrooms = m.match(/\b([123]) (?:dormitorios?|habitaciones?)\b/)
  const resolved = resolveCatalogReference(catalog, current, summary._unit_reference, info.historial)
  const reference = object(info.referencia_unidad)
  const referenceIds = rows(reference.matches).map(unit => unit.id)
  const savedIds = rows(catalog).filter(unit => (Array.isArray(object(summary._unit_reference).ids) ? object(summary._unit_reference).ids as unknown[] : []).includes(unit.id)).map(unit => unit.id)
  let selected: Row[]
  if (resolved.hasUnitMention || reference.hasUnitMention === true) selected = resolved.matches
  else if (category || bedrooms) selected = catalog.filter(unit => (!category || unit.category === category) && (!bedrooms || Number(unit.bedrooms) === Number(bedrooms[1])))
  else if (resolved.matches.length || referenceIds.length || savedIds.length) {
    const ids = resolved.matches.length ? resolved.matches.map(unit => unit.id) : referenceIds.length ? referenceIds : savedIds
    selected = catalog.filter(unit => ids.includes(unit.id))
  } else {
    const preferred = text(object(info.lead).preferred_category)
    selected = preferred ? catalog.filter(unit => unit.category === preferred) : []
    if (!preferred) return { reply: '¿De qué suite, departamento o local le gustaría conocer el precio?', quoted: false }
  }
  const priced = selected.filter(unit => Number.isFinite(Number(unit.published_commercial_price)) && Number(unit.published_commercial_price) > 0)
  if (!priced.length) return { reply: 'No tengo un precio autorizado para esa opción. El asesor puede confirmarlo antes de que tome una decisión.', quoted: false }
  const money = (value: unknown) => '$' + Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 })
  const unitName = (unit: Row) => `${unit.category === 'local' ? 'local' : unit.category === 'suite' ? 'suite' : 'departamento'} ${text(unit.unit_number)}`
  const approximate = policy.precios_aproximados === true
  let reply: string
  if (priced.length === 1) reply = `El precio${approximate ? ' aproximado' : ''} ${priced[0].category === 'suite' ? 'de la' : 'del'} ${unitName(priced[0])} es de ${money(priced[0].published_commercial_price)} USD.`
  else if (priced.length <= 3) reply = `Los precios${approximate ? ' aproximados' : ''} son: ${priced.map(unit => `${unitName(unit)}, ${money(unit.published_commercial_price)} USD`).join('; ')}.`
  else {
    const values = priced.map(unit => Number(unit.published_commercial_price))
    const min = Math.min(...values), max = Math.max(...values)
    reply = `Las opciones con precio registrado${approximate ? ' aproximado' : ''} ${min === max ? `tienen un valor de ${money(min)}` : `van de ${money(min)} a ${money(max)}`} USD.`
  }
  if (approximate) reply += ' Es un valor referencial de lanzamiento y puede cambiar hasta que se confirme el precio definitivo.'
  if (priced.length < selected.length) reply += ' Algunas de las otras unidades todavía no tienen precio registrado.'
  const finance = object(info.financiamiento)
  const memory = salesMemory(summary._sales_memory, info.historial)
  let financingOffer = ''
  if (!memory.financing_mentioned && !mentionsFinancing(current) && !Object.keys(object(finance.current)).length) {
    const partners = Array.isArray(finance.partners) ? finance.partners.map(text).filter(Boolean) : []
    if (partners.length) financingOffer = `También contamos con opciones de financiamiento con ${partners.join(' o ')} y le acompañamos en el proceso.`
  }
  return { reply: reply + (financingOffer ? ' ' + financingOffer : ''), financingOffer, quoted: true, prices: priced.map(unit => Number(unit.published_commercial_price)) }
}

export const PRICE_REPLY_RULES = `La política comercial de este turno prevalece sobre el historial y cualquier guion anterior.
Solo informe precios de catálogo autorizados: nunca reutilice un precio recordado si ahora está oculto.
En Lanzamiento, si precios_aproximados es true, identifique el valor como aproximado y explique brevemente que es referencial de lanzamiento y puede cambiar.
En Preventa informe el precio sin esa aclaración. No invente descuentos, precios, cuotas ni notificaciones futuras.
Si hay respuesta_precio_verificada, incluya esos datos y resuelva también las otras consultas; no vuelva a pedir la unidad ya identificada.
No repita ofertas de financiamiento ya mencionadas. No añada por rutina «la aprobación depende de la entidad» ni «la entidad evalúa cada solicitud»; ofrezca acompañamiento en el proceso.
Si le preguntan expresamente si el crédito está aprobado o garantizado, explique que la entidad debe evaluar el caso; nunca asegure una aprobación.`

export function priceReplyIssues(reply: string, info: Row, current = '', expectedPrices?: number[]) {
  const policy = object(info.politica_comercial), m = normalized(reply)
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
