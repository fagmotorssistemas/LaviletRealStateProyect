/** The delivered draft is the only authority for the wording of a question.
 * Models describe its meaning; they never need to reproduce a second copy. */
export function replyQuestions(reply: string): string[] {
  return (reply.replace(/https?:\/\/[^\s<>]+/g, '').match(/¿[^¿?]+\?|[^.!?¿\n]+\?/g) || [])
    .map(question => question.trim()).filter(Boolean)
}

export function replyQuestionText(reply: string): string {
  return replyQuestions(reply).join(' ')
}
