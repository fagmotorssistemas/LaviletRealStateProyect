import 'server-only'
import { object, rpc, scope, text } from './data'
import type { CtwaCapture } from './ctwa-from-kommo'

/** Códigos estables; no incluyen clid, teléfono ni IDs de contacto. */
export type CtwaPersistCode =
  | 'CTWA_NOOP'
  | 'CTWA_INSERTED'
  | 'CTWA_PRESERVED'
  | 'CTWA_DUPLICATE_RETRY'
  | 'CTWA_RPC_MISSING'
  | 'CTWA_TIMEOUT'
  | 'CTWA_DB_ERROR'
  | 'CTWA_UNEXPECTED'

export type CtwaPersistResult = {
  ok: boolean
  code: CtwaPersistCode
  /** Acción RPC si aplica; nunca contiene PII. */
  action: string
}

function classifyCtwaPersistError(error: unknown): CtwaPersistCode {
  const message = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    /timeout|timed out|aborted/i.test(message)
  ) {
    return 'CTWA_TIMEOUT'
  }
  // data.rpc formatea RPC_<NAME>_<CODE> (p. ej. PGRST202 / 42883).
  if (
    /RPC_LV_APP_PRESERVE_CTWA_(PGRST202|42883|42P01)\b/i.test(message) ||
    /function .*lv_app_preserve_ctwa.* does not exist/i.test(message) ||
    /Could not find the function.*lv_app_preserve_ctwa/i.test(message) ||
    /schema cache/i.test(message)
  ) {
    return 'CTWA_RPC_MISSING'
  }
  if (/^RPC_LV_APP_PRESERVE_CTWA_/i.test(message) || /\bPGRST\d+\b|\b23\d{3}\b|\b42\w{3}\b/.test(message)) {
    return 'CTWA_DB_ERROR'
  }
  return 'CTWA_UNEXPECTED'
}

/** Log seguro: solo código y motivo genérico; sin clid, teléfono ni contactId. */
export function logCtwaPersistFailure(code: CtwaPersistCode, reason: string) {
  console.error(
    JSON.stringify({
      scope: 'ctwa_attribution',
      code,
      reason: String(reason).slice(0, 120),
    }),
  )
}

function mapRpcAction(action: string): CtwaPersistCode {
  switch (action) {
    case 'inserted':
      return 'CTWA_INSERTED'
    case 'preserved_existing':
      return 'CTWA_PRESERVED'
    case 'duplicate_retry':
      return 'CTWA_DUPLICATE_RETRY'
    case 'noop_empty':
      return 'CTWA_NOOP'
    default:
      return 'CTWA_INSERTED'
  }
}

/**
 * Persiste ctwa_clid first-touch vía RPC preparada.
 * Nunca interrumpe la atención CRM: todos los fallos se clasifican y se registran sin PII.
 * No dispara Pixel ni CAPI.
 */
export async function preserveCtwaForContact(input: {
  contactId: number
  kommoId: number
  externalMessageId: string
  ctwa: CtwaCapture | null | undefined
}): Promise<CtwaPersistResult> {
  if (!input.ctwa?.clid) {
    return { ok: true, code: 'CTWA_NOOP', action: 'noop_no_clid' }
  }
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
    const action = text(result.action) || 'unknown'
    return { ok: true, code: mapRpcAction(action), action }
  } catch (error) {
    const code = classifyCtwaPersistError(error)
    logCtwaPersistFailure(
      code,
      error instanceof Error ? error.name || 'Error' : 'non_error_throw',
    )
    return { ok: false, code, action: 'failed' }
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
  } catch (error) {
    const code = classifyCtwaPersistError(error)
    // Reutilizar clasificación; get usa otra RPC — mapear missing genérico.
    const getCode =
      /lv_app_get_ctwa|PGRST202|42883|does not exist|schema cache/i.test(
        error instanceof Error ? error.message : String(error),
      )
        ? 'CTWA_RPC_MISSING'
        : code === 'CTWA_TIMEOUT'
          ? 'CTWA_TIMEOUT'
          : 'CTWA_DB_ERROR'
    logCtwaPersistFailure(getCode, 'get_ctwa_failed')
    return null
  }
}

/** Solo para tests unitarios de clasificación. */
export const __test = { classifyCtwaPersistError, mapRpcAction }
