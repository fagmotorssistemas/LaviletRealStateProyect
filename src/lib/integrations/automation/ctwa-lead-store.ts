import 'server-only'
import { object, rpc, scope, text } from './data'
import type { CtwaCapture } from './ctwa-from-kommo'

/**
 * Persiste ctwa_clid first-touch vía RPC preparada.
 * Si la migración aún no está aplicada, no falla el flujo CRM (solo omite captura).
 * No dispara Pixel ni CAPI.
 */
export async function preserveCtwaForContact(input: {
  contactId: number
  kommoId: number
  externalMessageId: string
  ctwa: CtwaCapture | null | undefined
}): Promise<{ action: string; clid: string | null }> {
  if (!input.ctwa?.clid) return { action: 'noop_no_clid', clid: null }
  try {
    const result = object(
      await rpc('lv_app_preserve_ctwa', {
        p_tenant_id: scope.tenant_id,
        p_project_id: scope.project_id,
        p_contact_id: String(input.contactId),
        p_kommo_id: input.kommoId,
        p_ctwa_clid: input.ctwa.clid,
        p_field_path: input.ctwa.fieldPath,
        p_source_id: input.ctwa.sourceId,
        p_source_url: input.ctwa.sourceUrl,
        p_referral_source_type: input.ctwa.referralSourceType,
        p_external_message_id: input.externalMessageId,
      }),
    )
    return {
      action: text(result.action) || 'unknown',
      clid: text(result.ctwa_clid) || input.ctwa.clid,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Migración no aplicada / función ausente: el mensaje CRM debe continuar.
    if (/lv_app_preserve_ctwa|function .* does not exist|schema cache/i.test(message)) {
      return { action: 'rpc_unavailable', clid: null }
    }
    throw error
  }
}

export async function getStoredCtwaClid(contactId: number): Promise<string | null> {
  try {
    const result = object(
      await rpc('lv_app_get_ctwa', {
        p_project_id: scope.project_id,
        p_contact_id: String(contactId),
      }),
    )
    if (result.found !== true) return null
    return text(result.ctwa_clid) || null
  } catch {
    return null
  }
}
