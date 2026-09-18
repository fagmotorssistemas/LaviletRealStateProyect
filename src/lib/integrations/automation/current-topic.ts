import { normalized } from './sdr-rules'

export const CURRENT_TOPIC_RULES = '\nLa petición actual prevalece sobre la unidad recordada: una pregunta sobre el edificio/proyecto no es una pregunta sobre el último departamento. «El departamento más grande» exige seleccionar por superficie interior verificada, no reutilizar el número anterior. Conserve de la respuesta base solo datos pertinentes al turno; elimine introducciones con referencias anteriores equivocadas, aunque sus cifras sean ciertas. No repita que no hay crédito directo cuando la consulta actual no trata de crédito directo: un precio o las amenidades no reabren esa explicación ni requieren elegir un banco.\n'

export function currentTopicReply(reply:string,current:string) {
  const m=normalized(current)
  if(/credito directo|financi\w*.*direct|directamente con (?:ustedes|el proyecto)|ustedes financian|financian ustedes/.test(m))return reply
  // Remove only a categorical direct-credit denial, not answers about other financing.
  return reply.replace(/(?:En La Vilet[, ]+)?(?:no (?:se )?(?:ofrece(?:mos|n)?|otorga(?:mos|n)?|da(?:mos|n)?|tenemos|contamos con)|el proyecto no ofrece)\s+cr[eé]dito directo(?: con el proyecto)?\s*[.;]?\s*/gi,'').trim()
}
