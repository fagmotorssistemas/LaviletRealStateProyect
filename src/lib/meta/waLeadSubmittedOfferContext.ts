import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isUnitOfferContext } from '@/lib/meta/waLeadSubmittedEligibility'

/**
 * Última oferta de unidades de bot o asesor en la conversación.
 * Sirve fuera del bot (asesor humano) y cuando ultima_respuesta no es oferta.
 */
export async function loadRecentUnitOfferText(
  admin: SupabaseClient,
  conversationId: string | null | undefined,
): Promise<string | null> {
  const id = String(conversationId || '').trim()
  if (!id) return null
  try {
    const { data, error } = await admin
      .from('messages')
      .select('content, role, sent_at')
      .eq('conversation_id', id)
      .in('role', ['bot', 'asesor'])
      .order('sent_at', { ascending: false })
      .limit(12)
    if (error || !Array.isArray(data)) return null
    for (const row of data) {
      const content = String((row as { content?: string }).content || '')
      if (isUnitOfferContext(content)) return content.slice(0, 4000)
    }
  } catch {
    /* soft-fail */
  }
  return null
}

/** Prefiere texto ya cargado si es oferta; si no, busca en mensajes bot/asesor. */
export async function resolveRecentUnitOfferText(input: {
  admin: SupabaseClient
  conversationId?: string | null
  preferredText?: string | null
}): Promise<string | null> {
  if (isUnitOfferContext(input.preferredText)) {
    return String(input.preferredText).slice(0, 4000)
  }
  return loadRecentUnitOfferText(input.admin, input.conversationId)
}
