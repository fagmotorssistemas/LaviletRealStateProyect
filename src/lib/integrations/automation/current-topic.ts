export const CURRENT_TOPIC_RULES = '\nLa petición actual prevalece sobre la unidad recordada: una pregunta sobre el edificio/proyecto no es una pregunta sobre el último departamento. «El departamento más grande» exige seleccionar por superficie interior verificada, no reutilizar el número anterior. Conserve de la respuesta base solo datos pertinentes al turno; elimine introducciones con referencias anteriores equivocadas, aunque sus cifras sean ciertas. En consultas de financiamiento es pertinente aclarar que no hay crédito directo. Ante otros temas no repita esa explicación sin necesidad: reformule el mensaje completo conservando su coherencia; nunca corte fragmentos dentro de una oración.\n'

/** Topic changes are handled by writing/review, never by deleting clauses. */
export function currentTopicReply(reply:string,_current:string) {
  void _current
  return reply
}
