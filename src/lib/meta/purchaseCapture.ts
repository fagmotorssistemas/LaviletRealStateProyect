/**
 * Captura Purchase (cierre comercial) → outbox.
 * Con delivery ON + corte + currency ISO → pending (flush Nest).
 * Históricos / sin moneda / antes del corte → review_hold (no liberar en masa).
 * Canal siempre website (dataset web); no confundir con procedencia WA del lead.
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildPurchaseIdempotencyKey,
  isPurchaseMetaSendEnabled,
  isPurchaseSaleEligibleForDelivery,
  META_NEST_BACKEND_PENDING_ERROR,
} from '@/lib/meta/metaMeasurementContract'
import {
  flushLocalMetaOutbox,
  OUTBOX_FLUSHABLE_STATUS,
  OUTBOX_REVIEW_HOLD_STATUS,
  persistMetaConversion,
} from '@/lib/meta/localOutbox'

export { isPurchaseMetaSendEnabled }

function isCoreSetupConservative(): boolean {
  return (
    (process.env.META_CORE_SETUP_CONSERVATIVE ||
      process.env.NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE ||
      'true')
      .trim()
      .toLowerCase() !== 'false'
  )
}

function normalizeCurrency(raw: string | null | undefined): string | null {
  const c = String(raw || '')
    .trim()
    .toUpperCase()
  if (!c || !/^[A-Z]{3}$/.test(c)) return null
  return c
}

export async function persistPurchasePrepared(
  admin: SupabaseClient,
  input: {
    saleId: string
    leadId: string
    unitId: string
    saleAt: string
    value: number
    currency?: string | null
    tenantId?: string | null
    projectId?: string | null
    /** Momento de registro del cierre (corte). Default: ahora. */
    registeredAt?: string | null
  },
): Promise<{
  inserted: boolean
  eventId: string
  rowId: string | null
  status: string
  deliveryEligible: boolean
  blockReason: string | null
}> {
  const saleId = String(input.saleId || '').trim()
  const leadId = String(input.leadId || '').trim()
  const unitId = String(input.unitId || '').trim()
  if (!saleId || !leadId || !unitId) {
    throw new Error('persistPurchasePrepared: saleId, leadId y unitId son obligatorios')
  }
  if (!Number.isFinite(input.value) || input.value <= 0) {
    throw new Error('persistPurchasePrepared: value inválido')
  }

  const currency = normalizeCurrency(input.currency)
  const registeredAt = String(input.registeredAt || new Date().toISOString())
  const deliveryOn = isPurchaseMetaSendEnabled()
  const afterCutover = isPurchaseSaleEligibleForDelivery(registeredAt)
  const deliveryEligible = Boolean(deliveryOn && afterCutover && currency)

  let blockReason: string | null = null
  if (!deliveryOn) blockReason = META_NEST_BACKEND_PENDING_ERROR
  else if (!afterCutover) blockReason = 'purchase_before_activation_cutover'
  else if (!currency) blockReason = 'purchase_currency_required_iso4217'

  const conservative = isCoreSetupConservative()
  const saleUnix = (() => {
    const ms = Date.parse(input.saleAt)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000)
    return Math.floor(Date.now() / 1000)
  })()

  const status = deliveryEligible
    ? OUTBOX_FLUSHABLE_STATUS
    : OUTBOX_REVIEW_HOLD_STATUS

  const result = await persistMetaConversion(admin, {
    eventName: 'Purchase',
    idempotencyKey: buildPurchaseIdempotencyKey(saleId),
    eventTime: saleUnix,
    leadId,
    adsConsentRequired: true,
    status,
    lastError: blockReason,
    payload: {
      action_source: 'website',
      lv_internal_subtype: 'compra',
      value: input.value,
      ...(currency ? { currency } : {}),
      ...(conservative
        ? {}
        : {
            content_ids: [unitId],
            content_type: 'product',
          }),
      sale_id: saleId,
      unit_id: unitId,
      sale_at: input.saleAt,
      registered_at: registeredAt,
      tenant_id: input.tenantId || undefined,
      project_id: input.projectId || undefined,
      details: {
        currency_omitted: !currency,
        currency_note: currency
          ? null
          : 'currency ISO-4217 requerida; no inventar. Bloqueado hasta moneda explícita.',
        delivery_enabled: deliveryOn,
        delivery_eligible: deliveryEligible,
        block_reason: blockReason,
        activation_cutover: process.env.META_PURCHASE_ACTIVATED_AT || null,
        annulment_gate: 'cancel_on_contract_anulado',
        channel: 'website',
        dataset: 'web_pixel',
      },
    },
  })

  if (deliveryEligible && result.inserted && result.eventId) {
    void flushLocalMetaOutbox(admin, { limit: 3, eventIds: [result.eventId] })
  }

  return {
    ...result,
    deliveryEligible,
    blockReason,
  }
}
