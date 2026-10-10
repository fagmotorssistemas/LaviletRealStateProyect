import { normalized } from './sdr-rules'

/** A yes/no invitation names one type without choosing a unit. Do not infer a
 * type from a preceding catalog paragraph or a question offering alternatives. */
export function categoryInvitationTarget(question: string): string {
  const value = normalized(question)
  if (!/\b(?:gustaria|desea|quiere|revisamos|exploramos|vemos|conocemos)\b/.test(value)
    || !/\b(?:explor\w*|revis\w*|conoc\w*|ver|veamos|vemos|comenz\w*|empez\w*)\b/.test(value)
    || /\s(?:o|u)\s|\bcual(?:es)?\b|\bque (?:tipo|planta|piso|unidad)\b|\b(?:plantas?|pisos?|nivel(?:es)?)\b|financiamiento|credito|reserva|visita|cita/.test(value)
    || /\b(?:departamentos?|apartamentos?|penthouses?|suites?|locales?)\s*(?:numero\s*)?\d{1,4}\b/.test(value)) return ''
  const names: [string, RegExp][] = [
    ['suite', /\bsuites?\b/], ['departamento', /\b(?:departamentos?|apartamentos?)\b/],
    ['penthouse', /\bpenthouses?\b/], ['local', /\blocal(?:es)?(?: comerciales?)?\b/],
  ]
  const targets = names.filter(([, pattern]) => pattern.test(value)).map(([category]) => category)
  return targets.length === 1 ? targets[0] : ''
}
