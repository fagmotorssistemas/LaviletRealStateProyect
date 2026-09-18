/**
 * Controles WhatsApp LeadSubmitted (BM). Default OFF — cero escrituras.
 */

export function isWaLeadSubmittedEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    String(env.META_WA_LEAD_SUBMITTED_ENABLED || '')
      .trim()
      .toLowerCase() === 'true'
  )
}

/** pending + drain Nest. Sin esto solo needs_review / bloqueos documentados. */
export function isWaLeadSubmittedDeliveryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isWaLeadSubmittedEnabled(env)) return false
  return (
    String(env.META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED || '')
      .trim()
      .toLowerCase() === 'true'
  )
}
