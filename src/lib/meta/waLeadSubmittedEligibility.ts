import { explicitPropertyInterest } from '@/lib/integrations/automation/commercial-engagement'
import { isGreetingOnly, normalized } from '@/lib/integrations/automation/sdr-rules'
import {
  WA_COMMERCIAL_SCORE_EVENTS,
  type WaLeadSubmittedBlocker,
} from '@/lib/meta/waLeadSubmittedContract'
import { detectsWhatsappAdsConsentGrant } from '@/lib/meta/waLeadSubmittedConsent'

/** Ventana para reutilizar interés comercial ya sellado tras aceptación de consentimiento. */
export const WA_RECENT_COMMERCIAL_INTEREST_MS = 48 * 60 * 60 * 1000

/** Oferta de unidades (bot o asesor): sin esto, «el más grande» no es interés inmobiliario. */
export function isUnitOfferContext(text: string | null | undefined): boolean {
  const offer = normalized(String(text || ''))
  if (!offer) return false
  return /(?:departamento|penthouse|suite|unidad|opcion|disponib|contamos con|estas son las opciones|alternativa|m²|m2|dormitorio|habitacion)/.test(
    offer,
  )
}

/**
 * Preferencia entre unidades ya ofrecidas (p. ej. «me interesa el más grande»).
 * Exige contexto de oferta reciente (bot o asesor). Sin oferta → no es interés.
 * No usa engagement histórico ni backfill.
 */
export function isOfferedUnitSelectionInterest(
  message: string,
  recentOfferText?: string | null,
): boolean {
  const raw = String(message || '').trim()
  if (!raw || /[?¿]/.test(raw)) return false
  if (!isUnitOfferContext(recentOfferText)) return false

  const m = normalized(raw)
  if (!m) return false
  if (
    /no (?:me interesa|quiero|prefiero|elijo)|solo (?:por )?curiosidad/.test(m)
  ) {
    return false
  }

  return (
    /(?:me interesa|prefiero|elijo|escojo|me quedo con|quiero|quisiera).{0,48}(?:el|la|lo|esa|ese|este|esta).{0,28}(?:mas |más )?(?:grande|peque[nñ]o|ampli[oa]|barato|caro|economic[oa]|completo)/.test(
      m,
    ) ||
    /(?:me interesa|prefiero).{0,40}(?:mas |más )?(?:el|la|lo) (?:mas |más )?grande/.test(
      m,
    ) ||
    /(?:me interesa|prefiero|elijo|escojo|me quedo con).{0,36}(?:la|el) (?:opcion|unidad|penthouse|departamento|suite|depto)/.test(
      m,
    ) ||
    /(?:me interesa|prefiero|elijo|escojo|me quedo con).{0,24}(?:esa|ese|este|esta|aquella|aquel)(?:\s|$|[,.!;])/.test(
      m,
    )
  )
}

export function isRecentCommercialInterestStamp(
  stampedAt: string | null | undefined,
  nowMs: number = Date.now(),
  maxAgeMs: number = WA_RECENT_COMMERCIAL_INTEREST_MS,
): boolean {
  if (!stampedAt) return false
  const t = Date.parse(String(stampedAt))
  if (!Number.isFinite(t)) return false
  const age = nowMs - t
  return age >= 0 && age <= maxAgeMs
}

/**
 * Interés comercial del **turno actual** (texto / eventos / selección con oferta).
 * No incluye sello reciente ni consentimiento.
 */
export function isCommercialInterestEvidence(input: {
  currentMessage: string
  scoreEvents?: string[] | null
  /** Última oferta bot/asesor con unidades (contexto; no historial antiguo indiscriminado). */
  recentOfferText?: string | null
}): boolean {
  if (explicitPropertyInterest(input.currentMessage)) return true
  if (
    isOfferedUnitSelectionInterest(
      input.currentMessage,
      input.recentOfferText,
    )
  ) {
    return true
  }
  const events = Array.isArray(input.scoreEvents) ? input.scoreEvents : []
  return events.some((e) =>
    (WA_COMMERCIAL_SCORE_EVENTS as readonly string[]).includes(e),
  )
}

/**
 * Secuencia explícita:
 * 1) Interés comercial del turno → sella `commercialInterestAt` (en delivery).
 * 2) Asesor pide consentimiento (manual).
 * 3) Aceptación: puede encolar con el sello reciente; la aceptación sola no es interés.
 * No hay backfill de mensajes antiguos.
 */
export function evaluateWaLeadSubmittedEligibility(input: {
  currentMessage: string
  /** @deprecated Ignorado: engagement histórico no convierte. */
  propertyInterest?: boolean
  scoreEvents?: string[] | null
  forceGreeting?: boolean
  recentOfferText?: string | null
  /** Sello de interés comercial previo (ventana corta). */
  commercialInterestAt?: string | null
  nowMs?: number
}): {
  greetingOnly: boolean
  commercialInterest: boolean
  /** Interés expresado en este mensaje (no sello reciente). */
  turnCommercialInterest: boolean
  /** Aceptación + sello reciente (sin tratar el grant como interés). */
  usedRecentInterestWithConsent: boolean
  eligibleForConversion: boolean
  blocker: WaLeadSubmittedBlocker | null
} {
  const greetingOnly =
    input.forceGreeting === true || isGreetingOnly(input.currentMessage)
  if (greetingOnly) {
    return {
      greetingOnly: true,
      commercialInterest: false,
      turnCommercialInterest: false,
      usedRecentInterestWithConsent: false,
      eligibleForConversion: false,
      blocker: 'greeting_only_not_conversion',
    }
  }

  const turnCommercialInterest = isCommercialInterestEvidence({
    currentMessage: input.currentMessage,
    scoreEvents: input.scoreEvents,
    recentOfferText: input.recentOfferText,
  })

  const consentGrantedThisTurn = detectsWhatsappAdsConsentGrant(
    input.currentMessage,
    { fromBot: false },
  )
  const usedRecentInterestWithConsent =
    !turnCommercialInterest &&
    consentGrantedThisTurn &&
    isRecentCommercialInterestStamp(input.commercialInterestAt, input.nowMs)

  const commercialInterest =
    turnCommercialInterest || usedRecentInterestWithConsent

  if (!commercialInterest) {
    return {
      greetingOnly: false,
      commercialInterest: false,
      turnCommercialInterest: false,
      usedRecentInterestWithConsent: false,
      eligibleForConversion: false,
      blocker: 'commercial_interest_required',
    }
  }
  return {
    greetingOnly: false,
    commercialInterest: true,
    turnCommercialInterest,
    usedRecentInterestWithConsent,
    eligibleForConversion: true,
    blocker: null,
  }
}
