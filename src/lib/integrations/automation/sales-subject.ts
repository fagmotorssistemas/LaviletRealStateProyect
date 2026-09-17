import { object, text } from './data'
import { normalized } from './sdr-rules'

type Subject = 'vehicle' | 'property' | 'unknown'
type Category = 'suite' | 'departamento' | 'local' | 'vivienda' | null
const vehicles = /\b(?:carro|auto|vehiculo|coche|camioneta|moto)s?\b/g
const properties = /\b(?:suites?|depart[ae]mentos?|deptos?|viviendas?|casas?|propiedades?|inmuebles?|local(?:es)?|lavilet|la vilet|proyecto)\b/g
const acknowledged = (m: string) => !/no (?:entiendo|entendi|comprendo)/.test(m)
  && /(?:^|\b)(?:oh entiendo|entiendo|entendi|entendido|ya (?:se|entendi|veo)|ah (?:bueno|ok)|ok|de acuerdo|gracias por aclarar)(?:\b|$)/.test(m)
const propertyContext = /parque|garaje|estacion|parte de pago|como pago|permuta|como entrada|como abono|vendo mi|vender mi/

// Recognize the semantic classifier's replies as well as older vehicle templates.
// Accepting an explanation about any unrelated service returns to the offered
// property context; the previous off-topic noun must not own later price questions.
export function isPropertyScopeRedirect(value: string) {
  const m = normalized(value)
  const property = /la\s*vilet|inmobiliari|suite|departamento|vivienda|local(?:es)? comercial/.test(m)
  const boundary = /no (?:somos|gestionamos|organizamos|vendemos|alquilamos|prestamos|ofrecemos|atendemos|realizamos|brindamos)|no (?:los )?(?:vendemos|alquilamos)|no (?:le )?podemos ayudar|no poder ayudar|no corresponde a|nuestra atencion se centra|solo (?:atendemos|brindamos informacion|podemos ayudar)/.test(m)
  return property && boundary
}

export const purchasePriceQuestion = (value: string) => /\b(?:precios?|valor(?:es)?|vale|valen|cuesta|cuestan|costos?|cotizacion|cotizar|coticemos|cotice|cotizame)\b|\bcuanto (?:sale|salen|piden|paga)/.test(normalized(value))

// Ownership is a housing requirement in a property conversation, not a request
// to buy another product. Explicit vehicle transactions still keep their scope.
export function mentionsOwnedVehicle(value: string) {
  const m = normalized(value)
  return /\b(?:tengo|tenemos|poseo|cuento con|dispongo de|mis?|nuestros?)\s+(?:(?:un|una|uno|dos|tres|cuatro|varios|varias|\d+)\s+)?(?:carro|auto|vehiculo|coche|camioneta|moto)s?\b/.test(m)
    && !/\b(?:comprar|compro|compramos|alquilar|rentar|vender|vendo|reparar|reparacion|mecanico|taller)\b/.test(m)
}

function explicitSubject(m: string): { subject: Subject; category: Category } | null {
  if (propertyContext.test(m) && /\b(?:auto|carro|vehiculo|moto)s?\b/.test(m)) return { subject: 'property', category: null }
  const property = [...m.matchAll(properties)].filter(match => {
    const before = m.slice(Math.max(0, match.index! - 55), match.index)
    return !/(?:no|ni)\s*(?:(?:quiero|busco|necesito|me interesan?|hablo de|me refiero a)\s*)?(?:(?:los|las|un|una|unos|unas)\s*)?$/.test(before)
  }).at(-1)
  const vehicle = [...m.matchAll(vehicles)].filter(match => {
    const before = m.slice(Math.max(0, match.index! - 45), match.index)
    return !/(?:no (?:los )?(?:venden|vendemos|alquilan|alquilamos)|(?:ya )?no (?:quiero|busco|hablo de|me refiero a))\s*(?:ni alquilan\s*)?$/.test(before)
  }).at(-1)
  if (property && (!vehicle || property.index! > vehicle.index!)) {
    const word = property[0]
    return { subject: 'property', category: /suite/.test(word) ? 'suite' : /depart|depto/.test(word) ? 'departamento' : /local/.test(word) ? 'local' : 'vivienda' }
  }
  return vehicle ? { subject: 'vehicle', category: null } : null
}

// Track what the client is asking about separately from the kind of question.
// Acknowledging a correction accepts the offered property context; a new explicit
// vehicle request can still switch back. Old nouns do not own the conversation forever.
export function salesSubject(current: string, history: unknown = []) {
  let subject: Subject = 'unknown', category: Category = null, redirected: Category = null
  let acceptedRedirect = false
  const previous = (Array.isArray(history) ? history : []).map(object)
  for (const row of [...previous, { role: 'cliente', content: current }]) {
    const m = normalized(text(row.content))
    if (['bot', 'asesor'].includes(text(row.role))) {
      if (isPropertyScopeRedirect(m)) {
        redirected = subject === 'property' && category ? category : /local/.test(m) && !/suite|departamento|vivienda/.test(m) ? 'local' : 'vivienda'
      }
      continue
    }
    if (row.role !== 'cliente') continue
    const ownedInPropertyConversation: boolean = mentionsOwnedVehicle(m) && (subject === 'property' || redirected !== null)
    const direct: { subject: Subject; category: Category } | null = ownedInPropertyConversation ? { subject: 'property', category: category || redirected } : explicitSubject(m)
    if (direct) {
      subject = direct.subject; category = direct.category; acceptedRedirect = false
      if (direct.subject === 'property') redirected = null
    } else if (redirected && (acknowledged(m) || purchasePriceQuestion(m)
      || /financ|credito|hipoteca|(?:lo|los) que (?:si )?(?:venden|ofrecen|tienen)|los suyos/.test(m))) {
      subject = 'property'; category = redirected; acceptedRedirect = true
    }
  }
  const m = normalized(current)
  const question = purchasePriceQuestion(current) ? 'price'
    : /financ|credito|hipotec|pichincha|jep/.test(m) ? 'financing'
      : /recomiend|sugier|cual (?:me|nos)/.test(m) ? 'recommendation'
        : acknowledged(m) ? 'acknowledgement' : 'other'
  return { subject, category, question, acceptedRedirect }
}
