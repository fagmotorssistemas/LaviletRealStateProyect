/**
 * Captura preparada Purchase (cierre comercial) → outbox review_hold.
 * No envía a Nest mientras META_PURCHASE_DELIVERY_ENABLED !== true
 * y nestSupportsEventSend('Purchase') sea false.
 *
 * Moneda: no inventar. Si el negocio no provee currency, se omite del payload
 * y se documenta en details (hoy unit_sales_closings sin columna currency).
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildPurchaseIdempotencyKey,
  isPurchaseMetaSendEnabled,
  META_NEST_BACKEND_PENDING_ERROR,
} from '@/lib/meta/metaMeasurementContract'
import {
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

export async function persistPurchasePrepared(
  admin: SupabaseClient,
  input: {
    saleId: string
    leadId: string
    unitId: string
    saleAt: string
    value: number
    currency?: string | null
  },
): Promise<{ inserted: boolean; eventId: string; rowId: string | null; status: string }> {
  const saleId = String(input.saleId || '').trim()
  const leadId = String(input.leadId || '').trim()
  const unitId = String(input.unitId || '').trim()
  if (!saleId || !leadId || !unitId) {
    throw new Error('persistPurchasePrepared: saleId, leadId y unitId son obligatorios')
  }
  if (!Number.isFinite(input.value) || input.value <= 0) {
    throw new Error('persistPurchasePrepared: value inválido')
  }

  const currencyRaw = String(input.currency || '').trim().toUpperCase()
  const hasCurrency = Boolean(currencyRaw)
  const conservative = isCoreSetupConservative()
  const saleUnix = (() => {
    const ms = Date.parse(input.saleAt)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000)
    return Math.floor(Date.now() / 1000)
  })()

  return persistMetaConversion(admin, {
    eventName: 'Purchase',
    idempotencyKey: buildPurchaseIdempotencyKey(saleId),
    eventTime: saleUnix,
    leadId,
    adsConsentRequired: true,
    status: OUTBOX_REVIEW_HOLD_STATUS,
    lastError: META_NEST_BACKEND_PENDING_ERROR,
    payload: {
      action_source: 'website',
      lv_internal_subtype: 'compra',
      value: input.value,
      ...(hasCurrency ? { currency: currencyRaw } : {}),
      ...(conservative
        ? {}
        : {
            content_ids: [unitId],
            content_type: 'product',
          }),
      sale_id: saleId,
      unit_id: unitId,
      sale_at: input.saleAt,
      details: {
        currency_omitted: !hasCurrency,
        currency_note: hasCurrency
          ? null
          : 'currency NULL u omitida; no inventar USD. Nest bloqueará Purchase sin ISO-4217.',
        delivery_enabled: isPurchaseMetaSendEnabled(),
        nest_backend_pending: true,
        annulment_gate: 'cancel_on_contract_anulado',
      },
    },
  })
}
