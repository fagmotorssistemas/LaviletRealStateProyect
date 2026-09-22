type OutboundMessage = { role?: unknown; sent_at?: unknown }

/** The most recent outbound author owns the current CRM conversation. */
export function advisorOwnsConversation(messages: OutboundMessage[], inboundAt: string) {
  const cutoff = Date.parse(inboundAt)
  if (!Number.isFinite(cutoff)) return false
  const latest = messages
    .filter((message) => ['bot', 'asesor'].includes(String(message.role))
      && Number.isFinite(Date.parse(String(message.sent_at)))
      && Date.parse(String(message.sent_at)) < cutoff)
    .sort((a, b) => Date.parse(String(b.sent_at)) - Date.parse(String(a.sent_at)))[0]
  return latest?.role === 'asesor'
}
