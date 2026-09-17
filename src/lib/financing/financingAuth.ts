/** Auth y errores de esquema sin 'server-only' (testeable). */

export function isMissingInvestmentV2SchemaError(
  error: { message?: string; code?: string } | null | undefined,
) {
  const msg = String(error?.message || '')
  return (
    /column .* does not exist/i.test(msg) ||
    /could not find.*column/i.test(msg) ||
    /schema cache/i.test(msg) ||
    error?.code === 'PGRST204' ||
    error?.code === '42703'
  )
}

export function migrationRequiredError() {
  return new Error(
    'Guardado investment-v2 requiere la migración local supabase/migrations/20260917120000_investment_simulator_assumptions.sql (columnas simulation_mode, vacancy_rate_snapshot, calculation_version, etc.). No se confirmó un guardado incompleto.',
  )
}

export const INVESTMENT_V2_REQUIRED_COLUMNS = [
  'simulation_mode',
  'vacancy_rate_snapshot',
  'calculation_version',
  'rate_type',
  'assumptions_json',
] as const

type QueryResult = { data: Record<string, unknown> | null }

/** Cadena mínima estilo supabase-js para tests. */
export type AuthQueryBuilder = {
  select: (cols: string) => AuthQueryBuilder
  eq: (col: string, val: string) => AuthQueryBuilder
  order?: (col: string, opts?: unknown) => AuthQueryBuilder
  limit?: (n: number) => AuthQueryBuilder
  maybeSingle: () => Promise<QueryResult>
}

export type AuthAdminClient = {
  from: (table: string) => AuthQueryBuilder
}

/**
 * Autoriza escenarios solo con identidad de servidor confiable:
 * cookie lv_vid → tour_visitors.lead_id.
 * lead_id/teléfono del cliente no bastan por sí solos.
 */
export async function resolveAuthorizedLeadId(
  admin: AuthAdminClient,
  input: {
    leadId?: string | null
    phone?: string | null
    visitorKey?: string | null
    tenantId: string
    normalizePhone: (raw: string) => string
  },
) {
  const visitorKey = String(input.visitorKey ?? '').trim()
  if (!visitorKey) return null

  const visitorRes = await admin
    .from('tour_visitors')
    .select('lead_id')
    .eq('tenant_id', input.tenantId)
    .eq('visitor_key', visitorKey)
    .maybeSingle()

  const visitorLeadId = visitorRes.data?.lead_id ? String(visitorRes.data.lead_id) : null
  if (!visitorLeadId) return null

  const claimedLead = String(input.leadId ?? '').trim()
  if (claimedLead && claimedLead !== visitorLeadId) {
    return null
  }

  const phone = input.normalizePhone(String(input.phone ?? ''))
  if (phone) {
    const digits = phone.replace(/\D/g, '')
    const leadRes = await admin
      .from('leads')
      .select('id, phone, phone_normalized')
      .eq('id', visitorLeadId)
      .maybeSingle()
    if (!leadRes.data?.id) return null
    const leadDigits = String(leadRes.data.phone_normalized || leadRes.data.phone || '').replace(
      /\D/g,
      '',
    )
    if (leadDigits && digits && leadDigits !== digits) {
      return null
    }
  }

  return visitorLeadId
}
