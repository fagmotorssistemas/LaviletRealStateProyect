import { object, text } from './data'

// Only removable courtesy clauses. Never strip yes/no, a greeting, an apology,
// a qualification, or a factual sentence just because it resembles an opener.
const courtesy = /^(claro(?:\s*,?\s*con\s+(?:mucho\s+)?gusto)?|con\s+(?:mucho\s+)?gusto(?:\s+le\s+(?:cuento|explico|comento|ayudo))?|por supuesto|desde luego|perfecto|excelente|muy bien|de acuerdo|gracias por (?:comentar(?:lo)?|aclarar(?:lo)?|compartir(?:lo)?))\s*[,.!:;]\s+/iu
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function replyOpening(reply: string) {
  const match = reply.trim().match(courtesy)
  if (!match) return null
  const phrase = normalize(match[1])
  const family = /claro|gusto|supuesto|desde luego/.test(phrase) ? 'disposicion'
    : /gracias/.test(phrase) ? 'agradecimiento' : 'aprobacion'
  return { family, prefix: match[0], phrase: match[1] }
}

export function recentReplyOpenings(history: unknown) {
  return (Array.isArray(history) ? history : []).map(object)
    .filter(row => ['bot', 'asesor'].includes(text(row.role))).slice(-6)
    .map(row => ({ text: text(row.content), opening: replyOpening(text(row.content)) }))
}

export function variedReplyOpening(reply: string, history: unknown) {
  const current = replyOpening(reply)
  if (!current) return reply
  const recent = recentReplyOpenings(history)
  const key = (phrase: string) => normalize(phrase).replace(/^claro.*$/, 'claro').replace(/^con (?:mucho )?gusto.*$/, 'con gusto')
  const repeated = recent.slice(-2).some(row => row.opening && key(row.opening.phrase) === key(current.phrase))
  const consecutiveCourtesy = recent.length >= 2 && recent.slice(-2).every(row => !!row.opening)
  if (!repeated && !consecutiveCourtesy) return reply
  let body = reply.trim().slice(current.prefix.length).trim()
  // A standalone courtesy is a complete answer. Do not remove it or emit blanks.
  if (!body) return reply
  for (let i = 0; i < 3; i++) {
    const next = replyOpening(body)
    if (!next) break
    const remainder = body.slice(next.prefix.length).trim()
    if (!remainder) break
    body = remainder
  }
  return body.replace(/^([\p{L}])/u, letter => letter.toLocaleUpperCase('es'))
}

export function openingWritingRules(history: unknown) {
  const recent = recentReplyOpenings(history)
  const starts = recent.map(row => row.text.split(/\s+/).slice(0, 9).join(' '))
  return `\nVARIEDAD Y CERCANÍA EN ESTE TURNO (prevalece sobre ejemplos de aperturas del guion):
Las últimas aperturas enviadas fueron: ${JSON.stringify(starts)}.
No copie la misma apertura en turnos consecutivos ni rote mecánicamente muletillas.
La amabilidad se expresa al escuchar y resolver la consulta concreta, no con una fórmula obligatoria al principio.
Varíe la estructura: responder el dato solicitado; conectar con una preferencia que acaba de expresar; explicar en una frase una diferencia; reconocer una inquietud cuando la haya; o introducir una comparación pertinente. Elija solo lo que encaje, sin inventar preferencias, beneficios o emociones.
En continuaciones puede comenzar por el departamento, el dato o una explicación. Evite encadenar validaciones y frases como «me alegra» en todos los turnos. No convierta el tono cercano en una ficha fría ni en entusiasmo exagerado.
Puede decir «perfecto» o «excelente» cuando el cliente acepta un paso concreto; «claro», «por supuesto» o «con gusto» cuando responde a una solicitud. Es opcional: no elogie dudas, dificultades económicas, quejas o cualquier afirmación por costumbre. Alterne con respuestas directas.
${recent.length >= 2 && recent.slice(-2).every(row => row.opening) ? 'Las últimas dos respuestas empezaron con cortesía: esta vez empiece por la respuesta concreta.' : 'Una apertura amable y breve es bienvenida si encaja con el mensaje; no está prohibida porque se haya utilizado varias respuestas atrás.'}
Respete las decisiones, condiciones, precios, enlaces y estados reales; variar el tono no permite cambiar los hechos.`
}
