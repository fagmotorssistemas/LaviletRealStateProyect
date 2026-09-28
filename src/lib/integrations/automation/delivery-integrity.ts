import { object, text, type Row } from './data'

/** A rejected fallback must never be restored by a later formatting/catalogue guard. */
export function unverifiedReply(audit: Row): string {
  if (object(audit.reference_resolution).status === 'clarification') return text(object(audit.catalog_query).operation) === 'compare'
    ? '¿Qué unidades le gustaría que comparemos?' : '¿Qué unidad le gustaría conocer?'
  return 'No he podido verificar una respuesta completa a su consulta.'
}

/** Only whitespace, known greetings and the documented amenidades vocabulary substitution are formatting. */
const canonical = (value: string) => value.trim()
  .replace(/^(?:hola|buenos días|buenas tardes|buenas noches)[,.!:\s]+/iu, '')
  .replace(/\bamenidades\b/giu, 'instalaciones').replace(/\s+/g, ' ').toLocaleLowerCase('es')

export function requiresContentReview(approved: string, final: string, confirmedNotice = '') {
  let body = final
  // Only the notice returned by the actual handoff may be excluded, and only once.
  if (confirmedNotice && body.startsWith(confirmedNotice + '\n\n')) body = body.slice(confirmedNotice.length).trimStart()
  return canonical(approved) !== canonical(body)
}
