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
    'Guardado investment-v2 requiere migraciones locales: 20260917120000_investment_simulator_assumptions.sql y 20260917180000_financing_scenario_visitor_scope.sql (columnas simulation_mode, vacancy_rate_snapshot, calculation_version, created_by_visitor_key, etc.). No se confirmó un guardado incompleto.',
  )
}

export const INVESTMENT_V2_REQUIRED_COLUMNS = [
  'simulation_mode',
  'vacancy_rate_snapshot',
  'calculation_version',
  'rate_type',
  'assumptions_json',
] as const

type QueryError = { message: string }
type QueryResult = { data: Record<string, unknown> | null; error?: QueryError | null }

/** Cadena mínima estilo supabase-js para tests. */
export type AuthQueryBuilder = {
  select: (cols: string) => AuthQueryBuilder
  eq: (col: string, val: string) => AuthQueryBuilder
  order?: (col: string, opts?: unknown) => AuthQueryBuilder
  limit: (n: number) => AuthQueryBuilder
  range: (from: number, to: number) => Promise<{ data: Record<string, unknown>[] | null; error?: QueryError | null }>
  update: (values: Record<string, unknown>) => AuthQueryBuilder
  is: (col: string, val: null) => Promise<{ error?: QueryError | null }>
  upsert: (values: Record<string, unknown>, opts: Record<string, unknown>) => Promise<{ error?: QueryError | null }>
  maybeSingle: () => Promise<QueryResult>
}

export type AuthAdminClient = {
  from: (table: string) => AuthQueryBuilder
}

function phoneDigits(raw: string, normalizePhone: (value: string) => string) {
  const digits = normalizePhone(raw).replace(/\D/g, '')
  return digits.startsWith('0') ? `593${digits.slice(1)}` : digits
}

/** El celular registrado identifica al visitante del showroom y sus escenarios. */
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
  const visitorRes = visitorKey
    ? await admin
        .from('tour_visitors')
        .select('id, lead_id')
        .eq('tenant_id', input.tenantId)
        .eq('visitor_key', visitorKey)
        .maybeSingle()
    : null
  if (visitorRes?.error) throw visitorRes.error
  const visitorLeadId = visitorRes?.data?.lead_id ? String(visitorRes.data.lead_id) : null

  const claimedLead = String(input.leadId ?? '').trim()
  const digits = phoneDigits(String(input.phone ?? ''), input.normalizePhone)
  let resolvedLeadId = visitorLeadId
  if (visitorLeadId && digits) {
    const leadRes = await admin
      .from('leads')
      .select('id, phone, phone_normalized')
      .eq('id', visitorLeadId)
      .maybeSingle()
    if (!leadRes.data?.id) return null
    const leadDigits = phoneDigits(String(leadRes.data.phone_normalized || leadRes.data.phone || ''), input.normalizePhone)
    if (leadDigits && leadDigits !== digits) {
      return null
    }
  }

  if (!resolvedLeadId && digits.length >= 8) {
    const normalized = await admin
      .from('leads')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('phone_normalized', `+${digits}`)
      .limit(1)
      .maybeSingle()
    if (normalized.error) throw normalized.error
    resolvedLeadId = normalized.data?.id ? String(normalized.data.id) : null

    // Legacy leads may have a formatted phone but no phone_normalized.
    if (!resolvedLeadId) {
      for (let start = 0; ; start += 500) {
        const page = await admin
          .from('leads')
          .select('id, phone')
          .eq('tenant_id', input.tenantId)
          .range(start, start + 499)
        if (page.error) throw page.error
        const match = page.data?.find(
          (lead) => phoneDigits(String(lead.phone ?? ''), input.normalizePhone) === digits,
        )
        if (match?.id) {
          resolvedLeadId = String(match.id)
          break
        }
        if (!page.data || page.data.length < 500) break
      }
    }
  }

  if (!resolvedLeadId || (claimedLead && claimedLead !== resolvedLeadId)) return null

  if (!visitorLeadId && visitorKey) {
    const link = visitorRes?.data?.id
      ? await admin.from('tour_visitors').update({ lead_id: resolvedLeadId }).eq('id', String(visitorRes.data.id)).is('lead_id', null)
      : await admin.from('tour_visitors').upsert(
          { tenant_id: input.tenantId, visitor_key: visitorKey, lead_id: resolvedLeadId },
          { onConflict: 'tenant_id,visitor_key', ignoreDuplicates: true },
        )
    if (link.error) throw link.error
  }

  return resolvedLeadId
}
