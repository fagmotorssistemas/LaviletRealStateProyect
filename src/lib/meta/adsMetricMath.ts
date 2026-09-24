/** Shared arithmetic; has no credentials, Graph calls or server dependencies. */
export function computeCrmCostPerLead(spend: number | null | undefined, contacts: number | null | undefined): number | null {
  if (spend == null || !Number.isFinite(spend) || spend < 0 || contacts == null || !Number.isFinite(contacts) || contacts <= 0) return null
  return Math.round(spend / contacts * 100) / 100
}
