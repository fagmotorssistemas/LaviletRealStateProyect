/**
 * Contrato de medición Meta — La Vilet (FE/CRM).
 * Subtipos internos ≠ payload publicitario Graph.
 * Nest allowlist operativa vs captura preparada (sin flush).
 */

export const META_NEST_OPERATIONAL_EVENTS = [
  'ViewContent',
  'Lead',
  'Schedule',
  'LeadSubmitted',
  'QualifiedLead',
  'AddToWishlist',
] as const

export type MetaNestOperationalEvent = (typeof META_NEST_OPERATIONAL_EVENTS)[number]

/** Captura local retenida cuando Purchase delivery está OFF. */
export const META_NEST_PENDING_EVENTS = ['Purchase'] as const

export type MetaNestPendingEvent = (typeof META_NEST_PENDING_EVENTS)[number]

export type MetaCaptureEventName = MetaNestOperationalEvent | MetaNestPendingEvent

export const META_INTERNAL_SUBTYPES = [
  'showroom_general',
  'detalle_unidad',
  'favorito',
  'solicitud',
  'cita',
  'compra',
] as const

export type MetaInternalSubtype = (typeof META_INTERNAL_SUBTYPES)[number]

/** Motivo outbox: fila retenida hasta soporte Nest / corte. */
export const META_NEST_BACKEND_PENDING_ERROR = 'nest_backend_pending' as const

export function isMetaNestOperationalEvent(name: string): name is MetaNestOperationalEvent {
  return (META_NEST_OPERATIONAL_EVENTS as readonly string[]).includes(name)
}

export function isMetaNestPendingEvent(name: string): name is MetaNestPendingEvent {
  return (META_NEST_PENDING_EVENTS as readonly string[]).includes(name)
}

/** Envío CAPI Purchase: requiere flag explícito. */
export function isPurchaseMetaSendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.META_PURCHASE_DELIVERY_ENABLED?.trim().toLowerCase() === 'true'
}

/**
 * Corte verificable: ISO en META_PURCHASE_ACTIVATED_AT.
 * Elegibilidad exige AMBAS evidencias existentes (no inventadas):
 * - registered_at: cuándo se registró el cierre en CRM
 * - sale_at: confirmación comercial ya registrada en el cierre
 * Un histórico cargado después (registered_at reciente + sale_at antiguo) queda fuera.
 */
export function getPurchaseActivatedAtMs(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.META_PURCHASE_ACTIVATED_AT?.trim()
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

function parseExistingTimestampMs(raw: string | number | Date | null | undefined): number | null {
  if (raw == null) return null
  if (raw instanceof Date) {
    const ms = raw.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null
    return raw > 1e12 ? raw : raw * 1000
  }
  const ms = Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : null
}

export function isPurchaseSaleEligibleForDelivery(
  input: {
    registeredAt: string | number | Date | null | undefined
    /** Confirmación comercial existente (sale_at). No inventar ni reescribir. */
    commercialConfirmedAt: string | number | Date | null | undefined
  },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isPurchaseMetaSendEnabled(env)) return false
  const cut = getPurchaseActivatedAtMs(env)
  if (cut == null) return false
  const regMs = parseExistingTimestampMs(input.registeredAt)
  const confirmedMs = parseExistingTimestampMs(input.commercialConfirmedAt)
  if (regMs == null || confirmedMs == null) return false
  return regMs >= cut && confirmedMs >= cut
}

export function nestSupportsEventSend(name: string): boolean {
  if (isMetaNestOperationalEvent(name)) return true
  if (name === 'Purchase') return isPurchaseMetaSendEnabled()
  return false
}

export function labelMetaInternalSubtype(subtype: string | null | undefined): string {
  switch (String(subtype || '').trim()) {
    case 'showroom_general':
      return 'Showroom general'
    case 'detalle_unidad':
      return 'Detalle de unidad'
    case 'favorito':
      return 'Favorito'
    case 'solicitud':
      return 'Solicitud de información'
    case 'cita':
      return 'Cita'
    case 'compra':
      return 'Compra'
    default:
      return '—'
  }
}

export function subtypeForEventName(
  eventName: string,
  payloadSubtype?: string | null,
): MetaInternalSubtype | null {
  const fromPayload = String(payloadSubtype || '').trim()
  if ((META_INTERNAL_SUBTYPES as readonly string[]).includes(fromPayload)) {
    return fromPayload as MetaInternalSubtype
  }
  switch (eventName) {
    case 'AddToWishlist':
      return 'favorito'
    case 'Lead':
      return 'solicitud'
    case 'Schedule':
      return 'cita'
    case 'Purchase':
      return 'compra'
    case 'ViewContent':
      return null
    case 'LeadSubmitted':
      return 'solicitud'
    default:
      return null
  }
}

/** Idempotencia showroom general (una emisión por sesión de visitante). */
export function buildShowroomGeneralVisitKey(visitorKey: string): string {
  return `view:showroom:${visitorKey || 'anon'}`
}

/** Idempotencia favorito: operación persistida (lead + unit). */
export function buildWishlistIdempotencyKey(leadId: string, unitId: string): string {
  return `wishlist:${leadId}:${unitId}`
}

/** Idempotencia compra: cierre comercial. */
export function buildPurchaseIdempotencyKey(saleId: string): string {
  return `purchase:${saleId}`
}
