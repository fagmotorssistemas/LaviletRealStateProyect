/** A transfer notice does not invalidate a reviewed clarification or question. */
export function withHandoffNotice(reply: string, notice: string): string {
  if (!notice || reply.includes(notice)) return reply
  return reply.trim() ? `${notice}\n\n${reply}` : notice
}
