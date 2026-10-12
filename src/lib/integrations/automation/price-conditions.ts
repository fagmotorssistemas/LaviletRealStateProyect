import { object, type Row } from './data'
import { parseCommercialPrice } from '@/lib/inmobiliaria/unitPrices'

export const REFERENTIAL_PRICE_NOTICE = 'Estos son los precios referenciales vigentes y pueden cambiar.'

/** Notice visibility never changes the commercial nature or disclosure permission of a price. */
export function referentialPriceNoticeRequired(policyInput: unknown): boolean {
  const policy = object(policyInput)
  return policy.precios_aproximados === true && policy.aviso_precios_referenciales !== false && policy.precios_autorizados !== false
}

export const REFERENTIAL_PRICE_NOTICE_RULES = `AVISO AUTOMÁTICO DE PRECIOS: si politica_comercial.precios_aproximados=true y aviso_precios_referenciales no es false, al comunicar precios conserve su carácter referencial vigente y posibilidad de cambio con cualquier formulación equivalente. No exija mencionar lanzamiento ni otra etapa para cumplir el aviso. La etapa por sí sola no decide ese aviso; no la añada por costumbre. Si aviso_precios_referenciales=false, no añada automáticamente la aclaración «son referenciales y pueden cambiar» ni una equivalente. Ese ajuste solo controla el aviso rutinario: no cambia los precios, su naturaleza aproximada, sus permisos de publicación ni las condiciones comerciales verificadas. Si el cliente pregunta expresamente por vigencia, cambios o condiciones, responda esa consulta con los hechos y políticas disponibles; nunca deduzca que el precio es fijo o está garantizado por tener el aviso desactivado.`
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

function disclosedPurchasePrice(reply: string, verified: Row, audit: Row): boolean {
  const units = [...rows(verified.catalogo), ...rows(verified.catalogo_verificacion),
    ...rows(object(audit.catalog_results).units), ...rows(object(audit.response_plan).protected_facts)]
  const knownPrices = new Set(units.map(unit => Number(unit.published_commercial_price)).filter(value => Number.isFinite(value) && value > 0))
  // Currency alone can describe a budget, income, down payment or instalment.
  // Match complete amounts and a purchase-price subject in the same clause.
  return reply.split(/[\n!?;]+|\.(?=\s+[A-ZÁÉÍÓÚ¿])/).some(clause => {
    const m = normalized(clause)
    const priceSubject = /\b(?:precios?|cuestan?|costaran?|valen?|valor(?:es)?(?:\s+(?:de|del|para|referencial|actual|total|desde|entre|es))|parten\s+de|desde|se\s+(?:ubican|situan))\b/.test(m)
    const propertySubject = /\b(?:departamentos?|penthouses?|suites?|unidades?|viviendas?|inmuebles?|locales?|opciones?)\b/.test(m)
    const explicitPurchasePrice = /\b(?:precios?|cuestan?|valen?|precio\s+total|valor\s+(?:del|de\s+la)\s+(?:departamento|penthouse|suite|unidad|vivienda|inmueble|local))\b/.test(m)
      || propertySubject && /\bparten\s+de\b/.test(m)
    const financeOnly = /\b(?:presupuesto|efectivo|ahorros?|ingresos?|sueldo|entrada|cuotas?|mensualidad|credito|prestamo|financiamiento)\b/.test(m)
      && !explicitPurchasePrice
    if (financeOnly || !priceSubject && !propertySubject) return false
    const amounts = [...clause.matchAll(/(?:US\s*\$|\$|USD)\s*(\d(?:[\d.,]*\d)?)(?:\s*(mil|k)\b)?|(\d(?:[\d.,]*\d)?)(?:\s*(mil|k)\b)?\s*(?:USD|d[oó]lares)\b/gi)]
    if (amounts.length && priceSubject) return true
    const tokens = amounts.length ? amounts.map(match => [match[1] || match[3], match[2] || match[4]])
      : [...clause.matchAll(/\b(\d(?:[\d.,]*\d)?)(?:\s*(mil|k)\b)?/gi)].map(match => [match[1], match[2]])
    return propertySubject && tokens.some(([amount, scale]) => {
      try { return knownPrices.has(Number(parseCommercialPrice(amount)) * (scale ? 1000 : 1)) } catch { return false }
    })
  })
}

function completeNotice(reply: string): boolean {
  const m = normalized(reply)
  const referential = /\b(?:referencial(?:es)?|aproximad[oa]s?|orientativ[oa]s?|de referencia)\b/.test(m)
  const variable = /\b(?:pueden?\s+(?:cambiar|variar)|podrian?\s+(?:cambiar|variar)|podran?\s+(?:cambiar|variar)|sujet[oa]s?\s+a\s+(?:cambios?|variaciones?|actualizaciones?|modificaciones?)|posibilidad\s+de\s+(?:cambio|variacion))\b/.test(m)
  return referential && variable
}

/** Prepare a policy-owned qualifier BEFORE reviewing the complete message. */
export function ensureReferentialPriceConditions(reply: string, verified: Row, audit: Row = {}): { reply: string; applied: boolean } {
  const policy = object(verified.politica_comercial)
  if (!reply.trim() || !referentialPriceNoticeRequired(policy)
    || !disclosedPurchasePrice(reply, verified, audit) || completeNotice(reply)) return { reply, applied: false }
  // Keep the customer's next decision at the end of the message, including a
  // preceding bridge. Never append a new commercial question or change amounts.
  const questionStart = reply.lastIndexOf('¿')
  const paragraphStart = questionStart >= 0 ? reply.lastIndexOf('\n\n', questionStart) : -1
  const sentenceEnds = questionStart >= 0 ? [...reply.slice(0, questionStart).matchAll(/[.;]\s+/g)] : []
  const sentenceStart = sentenceEnds.length ? Number(sentenceEnds.at(-1)!.index) + 1 : questionStart
  const insertAt = questionStart >= 0 ? paragraphStart >= 0 ? paragraphStart : sentenceStart : reply.length
  const before = reply.slice(0, insertAt).trimEnd(), after = reply.slice(insertAt).trimStart()
  return { reply: [before, REFERENTIAL_PRICE_NOTICE, after].filter(Boolean).join('\n\n'), applied: true }
}
