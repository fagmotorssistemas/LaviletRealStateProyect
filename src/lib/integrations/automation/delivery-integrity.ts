import { object, text, type Row } from './data'

/** Bounded recovery acknowledges the unresolved intent without pretending a
 * catalogue listing answered it. It never promises a retry or an unexecuted handoff. */
export function pendingTurnReply(audit: Row): string {
  const intent = object(audit.resolved_turn_intent)
  const topics: Record<string, string> = {
    ask_price: 'su consulta de precios', compare_options: 'la comparación de las opciones',
    compare_properties: 'la comparación de las opciones', ask_features: 'las características que consulta',
    project_information: 'las opciones que está buscando', select_property: 'la opción que le interesa',
    ask_financing: 'su consulta de financiamiento', request_visit: 'su consulta sobre la visita',
  }
  const topic = topics[text(intent.objective)]
  return topic ? `Tengo pendiente responderle sobre ${topic}. No he podido validar una respuesta completa en este momento.`
    : 'Tengo pendiente su consulta. No he podido validar una respuesta completa en este momento.'
}

/** A rejected fallback must never be restored by a later formatting/catalogue guard. */
export function unverifiedReply(audit: Row): string {
  if (object(object(audit.turn_completeness).recovery).version === 'turn-recovery-v1'
    || object(audit.recovery).version === 'turn-recovery-v1') return pendingTurnReply(audit)
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
