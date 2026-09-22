import type { LeadInteraction, LeadTimelineItem } from '@/types/inmobiliaria'

function whatsappDirection(role: string): 'inbound' | 'outbound' {
  return role === 'cliente' ? 'inbound' : 'outbound'
}

/** Une notas manuales y mensajes WhatsApp del lead (solo lectura / merge en memoria). */
export function mergeLeadTimeline(
  interactions: LeadInteraction[],
  messages: Array<{ id: string; role: string; content: string | null; sent_at: string }>,
): LeadTimelineItem[] {
  const items: LeadTimelineItem[] = [
    ...interactions.map((interaction) => ({
      kind: 'interaction' as const,
      id: `interaction:${interaction.id}`,
      at: interaction.created_at,
      interaction,
    })),
    ...messages.map((row) => ({
      kind: 'whatsapp' as const,
      id: `whatsapp:${row.id}`,
      at: row.sent_at,
      message: {
        id: row.id,
        role: row.role,
        content: row.content,
        sent_at: row.sent_at,
        direction: whatsappDirection(row.role),
      },
    })),
  ]
  return items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
}
