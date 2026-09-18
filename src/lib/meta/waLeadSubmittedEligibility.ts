import { explicitPropertyInterest } from '@/lib/integrations/automation/commercial-engagement'
import { isGreetingOnly } from '@/lib/integrations/automation/sdr-rules'
import {
  WA_COMMERCIAL_SCORE_EVENTS,
  type WaLeadSubmittedBlocker,
} from '@/lib/meta/waLeadSubmittedContract'

/**
 * Interés comercial **expresado por el cliente en este turno**.
 * No usa "engagement" histórico: saludos / "ok" / ambiguos no convierten
 * aunque el lead ya estuviera marcado interesado.
 */
export function isCommercialInterestEvidence(input: {
  currentMessage: string
  scoreEvents?: string[] | null
}): boolean {
  if (explicitPropertyInterest(input.currentMessage)) return true
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
