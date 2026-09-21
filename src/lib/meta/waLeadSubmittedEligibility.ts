import { explicitPropertyInterest } from '@/lib/integrations/automation/commercial-engagement'
import { isGreetingOnly, normalized } from '@/lib/integrations/automation/sdr-rules'
import {
  WA_COMMERCIAL_SCORE_EVENTS,
  type WaLeadSubmittedBlocker,
} from '@/lib/meta/waLeadSubmittedContract'

/**
 * Preferencia entre unidades ya ofrecidas en el turno (p. ej. «me interesa el más grande»).
 * No usa engagement histórico ni reprocesa saludos pasados.
 * Si hay contexto de oferta reciente del bot, también acepta deíxis («esa», «este»).
 */
export function isOfferedUnitSelectionInterest(
  message: string,
  recentOfferText?: string | null,
): boolean {
  const raw = String(message || '').trim()
  if (!raw || /[?¿]/.test(raw)) return false
  const m = normalized(raw)
  if (!m) return false
  if (
    /no (?:me interesa|quiero|prefiero|elijo)|solo (?:por )?curiosidad/.test(m)
  ) {
    return false
  }

  const comparative =
    /(?:me interesa|prefiero|elijo|escojo|me quedo con|quiero|quisiera).{0,48}(?:el|la|lo|esa|ese|este|esta).{0,28}(?:mas |más )?(?:grande|peque[nñ]o|ampli[oa]|barato|caro|economic[oa]|completo)/.test(
      m,
    ) ||
    /(?:me interesa|prefiero).{0,40}(?:mas |más )?(?:el|la|lo) (?:mas |más )?grande/.test(
      m,
    ) ||
    /(?:me interesa|prefiero|elijo|escojo|me quedo con).{0,36}(?:la|el) (?:opcion|unidad|penthouse|departamento|suite|depto)/.test(
      m,
    )

  if (comparative) return true

  const deictic =
    /(?:me interesa|prefiero|elijo|escojo|me quedo con).{0,24}(?:esa|ese|este|esta|aquella|aquel)(?:\s|$|[,.!;])/.test(
      m,
    )
  if (!deictic) return false

  const offer = normalized(String(recentOfferText || ''))
  if (!offer) return false
  return /(?:departamento|penthouse|suite|unidad|opcion|disponib|contamos con|estas son las opciones|alternativa|m²|m2|dormitorio)/.test(
    offer,
  )
}

/**
 * Interés comercial **expresado por el cliente en este turno**.
 * No usa "engagement" histórico: saludos / "ok" / ambiguos no convierten
 * aunque el lead ya estuviera marcado interesado.
 */
export function isCommercialInterestEvidence(input: {
  currentMessage: string
  scoreEvents?: string[] | null
  /** Última oferta/respuesta del bot en el hilo (solo contexto del turno; no historial antiguo). */
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

export function evaluateWaLeadSubmittedEligibility(input: {
  currentMessage: string
  /** @deprecated Ignorado: engagement histórico no convierte. */
  propertyInterest?: boolean
  scoreEvents?: string[] | null
  forceGreeting?: boolean
  recentOfferText?: string | null
}): {
  greetingOnly: boolean
  commercialInterest: boolean
  eligibleForConversion: boolean
  blocker: WaLeadSubmittedBlocker | null
} {
  const greetingOnly =
    input.forceGreeting === true || isGreetingOnly(input.currentMessage)
  if (greetingOnly) {
    return {
      greetingOnly: true,
      commercialInterest: false,
      eligibleForConversion: false,
      blocker: 'greeting_only_not_conversion',
    }
  }
  // propertyInterest histórico deliberadamente ignorado.
  const commercialInterest = isCommercialInterestEvidence({
    currentMessage: input.currentMessage,
    scoreEvents: input.scoreEvents,
    recentOfferText: input.recentOfferText,
  })
  if (!commercialInterest) {
    return {
      greetingOnly: false,
      commercialInterest: false,
      eligibleForConversion: false,
      blocker: 'commercial_interest_required',
    }
  }
  return {
    greetingOnly: false,
    commercialInterest: true,
    eligibleForConversion: true,
    blocker: null,
  }
}
