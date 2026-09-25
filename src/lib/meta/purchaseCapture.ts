/** Purchase nace únicamente de un cierre persistido y verificable. */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPurchaseIdempotencyKey, isPurchaseMetaSendEnabled, isPurchaseSaleEligibleForDelivery, META_NEST_BACKEND_PENDING_ERROR } from '@/lib/meta/metaMeasurementContract'
import { flushLocalMetaOutbox, OUTBOX_FLUSHABLE_STATUS, OUTBOX_REVIEW_HOLD_STATUS, persistMetaConversion } from '@/lib/meta/localOutbox'
import { homeListingCatalogIdentityParams } from '@/lib/meta/homeListingContent'

export { isPurchaseMetaSendEnabled }

function normalizeCurrency(raw: string | null | undefined): string | null {
  const value = String(raw || '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(value) ? value : null
}

export async function persistPurchasePrepared(
  admin: SupabaseClient,
  input: { saleId: string; leadId: string; unitId: string; tenantId?: string | null; projectId?: string | null },
): Promise<{ inserted: boolean; eventId: string; rowId: string | null; status: string; deliveryEligible: boolean; blockReason: string | null }> {
  const saleId = String(input.saleId || '').trim()
  const leadId = String(input.leadId || '').trim()
  const unitId = String(input.unitId || '').trim()
  if (!saleId || !leadId || !unitId) throw new Error('persistPurchasePrepared: identificadores obligatorios')

  const { data: sale, error } = await admin
    .from('unit_sales_closings')
    .select('id, tenant_id, unit_id, lead_id, sale_price_final, currency, sale_at, created_at')
    .eq('id', saleId).eq('lead_id', leadId).eq('unit_id', unitId).maybeSingle()
  if (error || !sale) throw new Error('persistPurchasePrepared: cierre persistido no verificable')

  const value = Number(sale.sale_price_final)
  const currency = normalizeCurrency(sale.currency)
  const registeredAt = String(sale.created_at || '').trim() || null
  const saleAt = String(sale.sale_at || '').trim() || null
  const saleMs = Date.parse(saleAt || '')
  const eventTime = Number.isFinite(saleMs) && saleMs > 0 ? Math.floor(saleMs / 1000) : 0
  const deliveryOn = isPurchaseMetaSendEnabled()
  const afterCutover = isPurchaseSaleEligibleForDelivery({ registeredAt, commercialConfirmedAt: saleAt })
  const evidenceEligible = Boolean(afterCutover && currency && registeredAt && saleAt && value > 0)
  const deliveryEligible = Boolean(deliveryOn && evidenceEligible)

  let blockReason: string | null = null
  if (!registeredAt) blockReason = 'purchase_registered_at_required'
  else if (!saleAt) blockReason = 'purchase_sale_at_required'
  else if (!Number.isFinite(value) || value <= 0) blockReason = 'purchase_value_required'
  else if (!currency) blockReason = 'purchase_currency_required_iso4217'
  else if (!deliveryOn) blockReason = META_NEST_BACKEND_PENDING_ERROR
  else if (!afterCutover) blockReason = 'purchase_before_activation_cutover'

  const listingContent = homeListingCatalogIdentityParams(unitId)

  const result = await persistMetaConversion(admin, {
    eventName: 'Purchase', idempotencyKey: buildPurchaseIdempotencyKey(saleId),
    // 0 es un sentinel local retenido; no suplanta la fecha real y nunca se entrega.
    eventTime, leadId, adsConsentRequired: true,
    // Flag OFF conserva pending; evidencia incompleta o fuera del corte queda retenida.
    status: evidenceEligible ? OUTBOX_FLUSHABLE_STATUS : OUTBOX_REVIEW_HOLD_STATUS,
    lastError: blockReason,
    payload: {
      action_source: 'system_generated', lv_internal_subtype: 'compra',
      sale_id: saleId, lead_id: leadId, unit_id: unitId, value,
      currency: currency || undefined, sale_at: saleAt || undefined,
      registered_at: registeredAt || undefined,
      ...(listingContent || {}),
      tenant_id: String(sale.tenant_id || input.tenantId || '') || undefined,
      project_id: input.projectId || undefined,
      details: { delivery_enabled: deliveryOn, delivery_eligible: deliveryEligible, block_reason: blockReason, activation_cutover: process.env.META_PURCHASE_ACTIVATED_AT || null, source: 'unit_sales_closings' },
    },
  })
  if (deliveryEligible && result.inserted) void flushLocalMetaOutbox(admin, { limit: 3, eventIds: [result.eventId] })
  return { ...result, deliveryEligible, blockReason }
}
