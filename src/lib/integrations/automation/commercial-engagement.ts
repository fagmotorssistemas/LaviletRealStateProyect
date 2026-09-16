import { object, text } from './data'
import { normalized } from './sdr-rules'
import { isPropertyScopeRedirect } from './sales-subject'

const property = /inmueble|departamento|suite|vivienda|local|proyecto|propiedad|la vilet|lavilet/
export function explicitPropertyInterest(value: string) {
  const m = normalized(value)
  if (/no (?:estoy interesad|me interesa|quiero comprar|quiero adquirir)|solo (?:por )?curiosidad/.test(m)) return false
  return /(?:quiero|quisiera|busco|deseo|me interesa|estoy interesad[oa] en) (?:comprar|adquirir|invertir)/.test(m)
    && (property.test(m) || !/taxi|comida|cafe|capuchino|vehiculo|carro|vuelo|moto/.test(m))
    || /(?:ahora si|si) (?:me interesa|estoy interesad[oa])/.test(m) && property.test(m)
    || /(?:quiero|quisiera|deseo|me gustaria).*(?:visitar|agendar una visita|revisar (?:mi |el )?financiamiento|iniciar (?:la |una )?evaluacion)/.test(m)
    || /(?:busco|quiero|quisiera|me interesa|necesito).*(?:departamento|suite|vivienda|local)/.test(m)
      && /\b[123] (?:dormitorios|habitaciones|cuartos)|para (?:vivir|invertir|mi negocio)|presupuesto|\$|\b\d{3}\b/.test(m)
}

/** Scope comprehension is not buying interest. Remember an explicit stop until real renewed interest. */
export function commercialEngagement(current: string, history: unknown, previous: unknown = {}) {
  const saved = object(previous)
  let passive = saved.passive_sales === true, interested = saved.property_interest === true
  const rows = (Array.isArray(history) ? history : []).map(object)
  for (const row of [...rows, { role: 'cliente', content: current }]) {
    const content = text(row.content), m = normalized(content)
    if (row.role === 'cliente') {
      if (/no (?:no )?(?:estoy interesad[oa]|me interesa)(?:\b|$)|no (?:quiero|deseo) (?:comprar|adquirir)|solo (?:por )?curiosidad|(?:numero|chat) equivocado|me equivoque de (?:numero|chat)/.test(m)) { passive = true; interested = false }
      else if (explicitPropertyInterest(content)) { passive = false; interested = true }
    } else if (['bot', 'asesor'].includes(text(row.role)) && isPropertyScopeRedirect(content)
      && !/no (?:vendemos|ofrecemos).{0,20}(?:casas|credito directo)/.test(m)) { passive = true; interested = false }
  }
  return { passive, interested }
}

export function passiveSalesRules(state: ReturnType<typeof commercialEngagement>) {
  return state.passive ? 'MODO INFORMATIVO: hubo rechazo expreso o confusión de negocio/número y no hay interés de compra renovado. Conteste todas las preguntas con datos verificados. No añada financiamiento, visita, brochure, preguntas de calificación ni otra invitación comercial no solicitada. Una pregunta de precio o «comprendo» no revoca el rechazo. Si pide explícitamente financiamiento, visita o asesor, atienda esa petición sin añadir otra oferta.' : ''
}

/** Detect unrequested offers without altering the draft or deleting any requested facts. */
export function passiveSalesCopy(reply: string, current: string, state: ReturnType<typeof commercialEngagement>) {
  if (!state.passive) return reply
  const requested = normalized(current)
  const clauses = reply.split(/(?<=[.!?])\s+|\n+/)
  const kept = clauses.filter(clause => {
    const m = normalized(clause)
    const offer = /podemos|puedo|si (?:le interesa|desea|quiere|esta interesado)|le gustaria|le interesa|desea (?:que|conocer|revisar|coordinar)|le invito|tambien|para el financiamiento trabajamos|le comparto|contamos con|tenemos opciones de financ|visitenos/.test(m)
    if (!offer) return true
    if (/financ|credito|pichincha|\bjep\b/.test(m) && !/financ|credito|pichincha|\bjep\b|no se si.*alcanz|no me alcanza/.test(requested)) return false
    if (/visita|oficina|cita/.test(m) && !/visita|oficina|cita/.test(requested)) return false
    if (/brochure|folleto|distribucion|muestre una opcion|opcion de ese rango/.test(m) && !/brochure|folleto|distribucion|muestre|opciones/.test(requested)) return false
    if (/\?/.test(clause) && /interesa|busca|presupuesto|dormitorio|para vivir|para invertir/.test(m)) return false
    return true
  })
  return kept.length === clauses.length ? reply : kept.map(c => c.trim()).filter(Boolean).join(' ')
}
