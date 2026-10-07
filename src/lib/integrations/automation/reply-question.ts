/** The delivered draft is the only authority for the wording of a question.
 * Models describe its meaning; they never need to reproduce a second copy. */
export function replyQuestions(reply: string): string[] {
  const content = reply.replace(/https?:\/\/[^\s<>]+/g, '')
  const questions = [...content.matchAll(/¿[^¿?]+\?|[^.!?¿\n]+\?/g)]
    .map(match => ({ text: match[0].trim(), index: match.index!, end: match.index! + match[0].length }))
  // A direct request can be a real CTA without question marks. Recognize its
  // grammatical request, not a topic mentioned in explanatory or future prose.
  for (const match of content.matchAll(/(?:^|[.!?\n])([^.!?¿\n]+)(?=[.!?\n]|$)/g)) {
    const fragment = match[1].trim()
    const value = fragment.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
    const request = value.match(/\b(?:indique(?:me|nos)?|diga(?:me|nos)?|cuente(?:me|nos)?|confirme(?:me|nos)?|elija|seleccione|especifique|senale|comparta(?:me|nos)?)\b/)
      || value.match(/\b(?:puede|podria|podrias|puedes)\s+(?:usted\s+)?(?:indicar(?:me|nos)|decir(?:me|nos)|contar(?:me|nos)|confirmar(?:me|nos)|compartir(?:me|nos))\b/)
    const prefix = request ? value.slice(0, request.index).trim() : ''
    const directedNow = !prefix || /^por favor[,\s]*$/.test(prefix)
      || prefix.endsWith(',') && !/\b(?:cuando|en cuanto|una vez|no es necesario|no hace falta|no necesita|no debe)\b/.test(prefix)
    const responseTarget = /\b(?:que|cual(?:es)?|cuant[oa]s?|donde|cuando|si|entre|prefiere|preferencia|nombre|residencia)\b/.test(value)
      || /\bo\b/.test(value)
    if (!request || !directedNow || !responseTarget) continue
    const index = match.index! + match[0].indexOf(match[1])
    if (!questions.some(question => index < question.end && index + match[1].length > question.index)) {
      questions.push({ text: fragment, index, end: index + match[1].length })
    }
  }
  return questions.sort((a, b) => a.index - b.index).map(question => question.text).filter(Boolean)
}

export function replyQuestionText(reply: string): string {
  return replyQuestions(reply).join(' ')
}
