/**
 * Cancela captura Purchase en outbox cuando el contrato se anula.
 * No reenvía ni libera otros review_hold.
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPurchaseIdempotencyKey } from '@/lib/meta/metaMeasurementContract'

export async function cancelPurchaseOutboxForSale(
  admin: SupabaseClient,
  saleId: string,
  reason = 'contract_anulado',
): Promise<number> {
  const id = String(saleId || '').trim()
  if (!id) return 0
  const key = buildPurchaseIdempotencyKey(id)
  const { data, error } = await admin
    .from('meta_capi_outbox')
    .update({
      status: 'cancelled',
      last_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('event_name', 'Purchase')
    .eq('idempotency_key', key)
    .in('status', ['pending', 'review_hold', 'needs_review'])
    .select('id')
  if (error) return 0
  return data?.length ?? 0
}

export async function cancelPurchaseOutboxForContract(
  admin: SupabaseClient,
  contractId: string,
): Promise<number> {
  const cid = String(contractId || '').trim()
  if (!cid) return 0
  const { data: closings } = await admin
    .from('unit_sales_closings')
    .select('id')
    .eq('contract_id', cid)
  if (!closings?.length) return 0
  let n = 0
  for (const c of closings) {
    n += await cancelPurchaseOutboxForSale(admin, String(c.id), 'contract_anulado')
  }
  return n
}
