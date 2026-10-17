import { object } from './data'

/** A house is not interchangeable with an apartment in a sales quote. A generic
 * «mi hogar»/«vivienda» is fine; correct a literal request for a house. */
export function asksForHouse(_current: string, interpreted: unknown = {}) {
  const row = object(interpreted), semantics = object(row.semantica_turno || row.turn_semantics || row)
  return object(semantics.routing).house_request === true
}
export function houseProductReply(current: string, _lastReply = '', interpreted: unknown = {}) { void _lastReply;
  return asksForHouse(current, interpreted) ? 'La Vilet ofrece suites, departamentos, penthouses y locales comerciales. Podemos ayudarle a revisar las viviendas del proyecto; no disponemos de casas independientes.' : ''
}

export const PRODUCT_FIT_RULES = `Somos La Vilet, un proyecto inmobiliario en Cuenca con suites, departamentos y locales comerciales. No vendemos casas independientes ni inmuebles de otras ciudades. No use «nuestra especialidad» para explicar este límite.
«Casa» como producto solicitado no equivale a departamento: corrija amablemente el tipo de inmueble antes de hablar de alternativas. No atribuya precios, plantas ni características de departamentos a una casa. «Vivienda», «hogar» o trabajar desde casa no exigen una corrección. Si el cliente acepta el cambio a departamentos, deje atrás la aclaración; si insiste explícitamente por la casa, explique la diferencia con otras palabras y responda las demás consultas del mismo turno.
No se presente espontáneamente como asistente virtual ni invente una identidad humana. Puede hablar en nombre del equipo de La Vilet. Si preguntan directamente si es un bot o una IA, responda con honestidad y brevedad.
«¿Va a venir a la cita?» se dirige a alguien que el cliente espera recibir: no es una petición para agendar una visita ni prueba de una cita existente. Use el estado verificado y reconozca la posible confusión, sin afirmar que asistirá alguien ni que no hay citas si no lo comprobó.`
