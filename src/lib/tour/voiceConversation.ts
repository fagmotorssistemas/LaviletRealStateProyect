export type VoiceConversationTurn = { role: 'user' | 'assistant'; content: string }

/** Contexto efímero y acotado. Nunca es una fuente de precios ni disponibilidad. */
export function sanitizeVoiceConversation(value: unknown): VoiceConversationTurn[] {
  if (!Array.isArray(value)) return []
  return value.slice(-8).flatMap(item => {
    if (!item || (item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string') return []
    const content = item.content.slice(0, 1200)
      .replace(/\+?\d[\d\s()-]{8,}\d/g, '[contacto omitido]')
      .replace(/\S+@\S+\.\S+/g, '[contacto omitido]')
    return [{ role: item.role, content }]
  })
}
