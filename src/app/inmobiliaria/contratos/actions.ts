'use server'

import { assertCanAccessCrmPath, assertCanWriteCrm } from '@/lib/auth/session'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { cancelPurchaseOutboxForContract } from '@/lib/meta/purchaseAnulation'

/**
 * Tras anular contrato: cancela captura Purchase en outbox (sin liberar otros holds).
 */
export async function cancelPurchaseOnContractAnulledAction(
  contractId: string,
): Promise<{ ok: true; cancelled: number } | { ok: false; error: string }> {
  try {
    await assertCanAccessCrmPath('/inmobiliaria/contratos')
    await assertCanWriteCrm()
    const admin = tryCreateAdminClient()
    if (!admin) return { ok: false, error: 'admin_unavailable' }
    const cancelled = await cancelPurchaseOutboxForContract(admin, contractId)
    return { ok: true, cancelled }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'cancel_failed',
    }
  }
}
