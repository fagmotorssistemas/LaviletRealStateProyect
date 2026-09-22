'use server'

import { assertCanAccessCrmPath, assertCanWriteCrm, getCrmDataClient } from '@/lib/auth/session'
import { listSalesClosings, recordUnitClosing } from '@/services/inmobiliaria.service'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { persistPurchasePrepared } from '@/lib/meta/purchaseCapture'
import type { UnitSalesClosing } from '@/types/inmobiliaria'

export async function listSalesClosingsAction(params: {
  tenantIds: string[]
  projectId?: string
  soldById?: string
  from?: string
  to?: string
  search?: string
}): Promise<UnitSalesClosing[]> {
  await assertCanAccessCrmPath('/inmobiliaria/ventas')
  if (!params.tenantIds.length) return []
  return listSalesClosings(await getCrmDataClient(), params)
}

export async function recordUnitClosingAction(
  payload: Parameters<typeof recordUnitClosing>[1],
): Promise<UnitSalesClosing> {
  await assertCanAccessCrmPath('/inmobiliaria/ventas')
  await assertCanWriteCrm()
  try {
    const closing = await recordUnitClosing(await getCrmDataClient(), payload)
    // Meta Purchase: canal website. Soft-fail; moneda explícita requerida para envío.
    if (closing?.id && payload.lead_id) {
      try {
        const admin = tryCreateAdminClient()
        if (admin) {
          const projectId =
            closing.unit && typeof closing.unit === 'object'
              ? String(
                  (closing.unit as { project_id?: string }).project_id ||
                    (closing.unit as { project?: { id?: string } }).project?.id ||
                    '',
                ).trim() || null
              : null
          await persistPurchasePrepared(admin, {
            saleId: String(closing.id),
            leadId: payload.lead_id,
            unitId: payload.unit_id,
            saleAt: String(closing.sale_at || payload.sale_at || new Date().toISOString()),
            value: payload.sale_price_final,
            currency:
              (closing as { currency?: string | null }).currency ||
              payload.currency ||
              null,
            tenantId: payload.tenant_id,
            projectId,
            registeredAt: String(closing.created_at || new Date().toISOString()),
          })
        }
      } catch (error) {
        console.error('[meta-purchase] persist soft fail', {
          sale_id: closing.id,
          error: error instanceof Error ? error.message.slice(0, 180) : 'error',
        })
      }
    }
    return closing
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'No se pudo registrar el cierre'
    throw new Error(message)
  }
}
