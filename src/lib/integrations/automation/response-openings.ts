import { CURRENT_TONE } from './conversation-tone'
import { object, text } from './data'

// Only removable courtesy clauses. Never strip yes/no, a greeting, an apology,
// a qualification, or a factual sentence just because it resembles an opener.
const courtesy = /^(claro(?:\s+que\s+s[ií])?(?:\s*,?\s*con\s+(?:mucho\s+)?gusto)?|con\s+(?:mucho\s+)?gusto(?:\s+le\s+(?:cuento|explico|comento|ayudo))?|por supuesto|desde luego|perfecto|excelente|muy bien|de acuerdo|gracias por (?:comentar(?:lo)?|aclarar(?:lo)?|compartir(?:lo)?))\s*[,.!:;]\s+/iu
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

export function decidedOpening(base: string, history: unknown) {
  const chosen = variedReplyOpening(base, history)
  return { prefix: replyOpening(chosen)?.prefix || '', removed_repetition: chosen !== base }
}

export function applyDecidedOpening(reply: string, prefix: string) {
  let body = reply.trim()
  for (let i = 0; i < 4; i++) {
    const opening = replyOpening(body)
    if (!opening) break
    body = body.slice(opening.prefix.length).trim()
  }
  return prefix + body
}

export function openingWritingRules(history: unknown) {
  const recent = recentReplyOpenings(history)
  const starts = recent.map(row => row.text.split(/\s+/).slice(0, 9).join(' '))
  return `\nVARIEDAD Y CERCANÍA EN ESTE TURNO (prevalece sobre ejemplos de aperturas del guion):
Las últimas aperturas enviadas fueron: ${JSON.stringify(starts)}.
${CURRENT_TONE.openingInstructions}${recent.length >= 2 && recent.slice(-2).every(row => row.opening) ? CURRENT_TONE.openingAfterCourtesy : CURRENT_TONE.openingOptional}
Respete las decisiones, condiciones, precios, enlaces y estados reales; variar el tono no permite cambiar los hechos.`
}
