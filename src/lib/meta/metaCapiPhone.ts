/**
 * Teléfono en bitácora CAPI: evento vs CRM por lead_id explícito.
 * No hay matching aproximado ni vínculo por visitor_key.
 */

export type MetaCapiPhoneSource = 'event' | 'crm_lead' | 'none'

export type MetaCapiPhoneView = {
  /** Valor a mostrar en la columna principal. */
  display: string
  /** Teléfono presente en el payload del evento (enviado a CAPI), si hubo. */
  eventPhone: string | null
  /** Teléfono del lead CRM vía lead_id + tenant autorizado, si hubo. */
  crmPhone: string | null
  source: MetaCapiPhoneSource
  /** Etiqueta corta de procedencia. */
  sourceLabel: string
}

export function normalizePhoneDisplay(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/[^\d+]/g, '').trim()
  return digits || null
}

export function phoneFromEventPayload(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null
  return (
    normalizePhoneDisplay(payload.phone) ||
    normalizePhoneDisplay(payload.user_phone) ||
    normalizePhoneDisplay(payload.wa_id)
  )
}

/**
 * Resuelve teléfono para UI.
 * - Prioridad de display: evento → CRM (solo si lead_id + tenant en alcance) → «Sin contacto asociado»
 * - Nunca usa visitor_key ni coincidencias aproximadas.
 */
export function resolveMetaCapiPhone(input: {
  eventPhone: string | null
  leadId: string | null
  leadTenantId: string | null
  leadPhone: string | null
  accessibleTenantIds: string[]
}): MetaCapiPhoneView {
  const eventPhone = input.eventPhone
  const crmAllowed =
    Boolean(input.leadId) &&
    Boolean(input.leadTenantId) &&
    input.accessibleTenantIds.includes(String(input.leadTenantId))
  const crmPhone = crmAllowed ? normalizePhoneDisplay(input.leadPhone) : null

  if (eventPhone) {
    return {
      display: eventPhone,
      eventPhone,
      crmPhone,
      source: 'event',
      sourceLabel: 'En el evento',
    }
  }
  if (crmPhone) {
    return {
      display: crmPhone,
      eventPhone: null,
      crmPhone,
      source: 'crm_lead',
      sourceLabel: 'Contacto CRM (lead_id)',
    }
  }
  return {
    display: 'Sin contacto asociado',
    eventPhone: null,
    crmPhone: null,
    source: 'none',
    sourceLabel: input.leadId
      ? 'lead_id sin teléfono autorizado'
      : 'Sin lead_id ni teléfono en evento',
  }
}
