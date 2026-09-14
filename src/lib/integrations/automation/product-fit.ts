import { normalized } from './sdr-rules'

/** A house is not interchangeable with an apartment in a sales quote. A generic
 * «mi hogar»/«vivienda» is fine; correct a literal request for a house. */
export function asksForHouse(current: string) {
  return current.split(/[.!?;\n]+|\bpero\b/iu).some(clause => {
    const value = normalized(clause)
    if (!/\bcasas?\b/.test(value)) return false
    if (/\b(?:no (?:quiero|busco|necesito|me refiero a)|vender mi|vendo mi|mi casa actual|salir de casa|trabajo (?:en|desde) casa|desde mi casa)\b/.test(value)) return false
    return /\b(?:una?|la|las|esas?|venden|ofrecen|tienen|comprar|busco) casas?\b/.test(value)
      && /\b(?:quiero|quisiera|busco|comprar|compro|financiar|cuanto|valor|vale|valen|cuesta|precio|pisos?|tiene|tienen|ofrecen|venden|necesito)\b/.test(value)
  })
}

export function houseProductReply(current: string, lastReply = '') {
  if (!asksForHouse(current)) return ''
  const repeated = /no (?:ofrecemos|vendemos|contamos con).*casas|no son casas/.test(normalized(lastReply))
  const base = repeated
    ? 'Las viviendas que ofrecemos son suites y departamentos dentro del edificio La Vilet; no son casas independientes.'
    : 'Para evitar una confusión, en La Vilet ofrecemos suites, departamentos y locales comerciales en Cuenca; no vendemos casas independientes.'
  return base + (/\bpisos?\b/.test(normalized(current))
    ? ' Por eso no puedo indicarle los pisos de una casa; sí podemos revisar en qué planta está cada departamento y su distribución.'
    : '')
}

export const PRODUCT_FIT_RULES = `Somos La Vilet, un proyecto inmobiliario en Cuenca con suites, departamentos y locales comerciales. No vendemos casas independientes ni inmuebles de otras ciudades. No use «nuestra especialidad» para explicar este límite.
«Casa» como producto solicitado no equivale a departamento: corrija amablemente el tipo de inmueble antes de hablar de alternativas. No atribuya precios, plantas ni características de departamentos a una casa. «Vivienda», «hogar» o trabajar desde casa no exigen una corrección. Si el cliente acepta el cambio a departamentos, deje atrás la aclaración; si insiste explícitamente por la casa, explique la diferencia con otras palabras y responda las demás consultas del mismo turno.
No se presente espontáneamente como asistente virtual ni invente una identidad humana. Puede hablar en nombre del equipo de La Vilet. Si preguntan directamente si es un bot o una IA, responda con honestidad y brevedad.
«¿Va a venir a la cita?» se dirige a alguien que el cliente espera recibir: no es una petición para agendar una visita ni prueba de una cita existente. Use el estado verificado y reconozca la posible confusión, sin afirmar que asistirá alguien ni que no hay citas si no lo comprobó.`
