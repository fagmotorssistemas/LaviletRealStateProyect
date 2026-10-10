import { normalized } from './sdr-rules'

const ordinals: Record<string, number> = { cero: 0, uno: 1, primer: 1, primera: 1, primero: 1,
  dos: 2, segundo: 2, segunda: 2, tres: 3, tercer: 3, tercero: 3, tercera: 3,
  cuatro: 4, cuarto: 4, cuarta: 4, cinco: 5, quinto: 5, quinta: 5,
  seis: 6, sexto: 6, sexta: 6, siete: 7, septimo: 7, septima: 7,
  ocho: 8, octavo: 8, octava: 8, nueve: 9, noveno: 9, novena: 9,
  diez: 10, decimo: 10, decima: 10 }
const token = '(?:\\d{1,2}(?:ta|to|ra|ro|da|do|ma|mo|va|vo)?|' + Object.keys(ordinals).join('|') + ')'

/** Check the meaning of a floor quote, not just whether the quote exists.
 * Relative height is useful guidance, but cannot supply an exact floor number.
 * Negations, intervals and multiple floors remain with their semantic contract. */
export function floorEvidence(evidence: string, answeringFloor = false): { kind: 'exact' | 'relative' | 'other'; number: number | null } {
  const value = normalized(evidence).trim()
  if (/\b(?:no|ni)\b[^.!?,;]{0,30}\b(?:planta|piso|nivel)\b|\b(?:excepto|salvo|entre|desde|hasta|menos de|mas de|al menos|como minimo|como maximo)\b/.test(value))
    return { kind: 'other', number: null }
  const joined = '\\s*(?:a|al|y|o|u)\\s*(?:(?:el|la)\\s+)?'
  const sharedLabel = new RegExp('\\b(?:planta|piso|nivel)s?\\s*(?:numero\\s*)?' + token + joined + token + '\\b|\\b' + token + '\\s*(?:(?:planta|piso|nivel)\\s*)?' + joined + token + '\\s*(?:planta|piso|nivel)\\b')
  if (sharedLabel.test(value)) return { kind: 'other', number: null }
  const floors = [...value.matchAll(new RegExp('\\b(?:planta|piso|nivel)\\s*(?:numero\\s*)?(' + token + ')\\b|\\b(' + token + ')\\s*(?:planta|piso|nivel)\\b', 'g'))]
    .map(match => ordinals[match[1] || match[2]] ?? Number.parseInt(match[1] || match[2], 10))
  if (answeringFloor && !floors.length) {
    const bare = value.match(new RegExp('^(?:la |el )?(' + token + ')[.! ]*$'))
    if (bare) floors.push(ordinals[bare[1]] ?? Number.parseInt(bare[1], 10))
  }
  if (/\bplanta baja\b/.test(value)) floors.push(0)
  const distinct = [...new Set(floors)]
  if (distinct.length === 1) return { kind: 'exact', number: distinct[0] }
  if (distinct.length > 1) return { kind: 'other', number: null }
  return { kind: /\b(?:plantas|pisos|niveles)\s+(?:mas\s+)?(?:bajos|bajas|altos|altas|inferiores|superiores)\b|\b(?:planta|piso|nivel)\s+(?:mas\s+)?(?:bajo|alto|baja|alta|inferior|superior)\b/.test(value)
    ? 'relative' : 'other', number: null }
}

/** Accepting a proposed floor is a requirement change, not an invitation to
 * choose a type or a request for an arbitrary floor. The sent text must name
 * one actual floor; metadata cannot supply a missing offer. */
export function floorInvitationTarget(question: string): number | null {
  const value = normalized(question)
  if (!/\b(?:gustaria|desea|quiere|podemos|revisamos|exploramos|vemos)\b/.test(value)
    || !/\b(?:explor\w*|revis\w*|conoc\w*|ver|veamos|vemos|consider\w*)\b/.test(value)
    || !/\b(?:planta|piso|nivel)\b/.test(value)
    || /\s(?:o|u)\s|\bcual(?:es)?\b|\bque (?:planta|piso|nivel|unidad)\b|financiamiento|credito|reserva|visita|cita/.test(value)
    || /\b(?:departamento|apartamento|penthouse|suite|local|unidad)\s*(?:numero\s*)?\d{1,4}\b/.test(value)) return null
  const floor = floorEvidence(question)
  return floor.kind === 'exact' ? floor.number : null
}
