export const TEST_RESPONSE_SETTING = 'automation_test_response_mode'
export const TEST_RESPONSE_PHONE = '0987110032'
export const TEST_RESPONSE_SECONDS = 0
export const NORMAL_RESPONSE_SECONDS = 30
/** Local Ecuadorian mobiles or an explicit international number. */
export function normalizeTestPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value.trim())) return null
  const digits = value.replace(/\D/g, '')
  if (/^09\d{8}$/.test(digits)) return `593${digits.slice(1)}`
  if (/^5939\d{8}$/.test(digits)) return digits
  if (value.trim().startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return digits
  return null
}
// Unpublished policy previews retain their separate authorization.
export function isTestPhone(value: unknown) { return normalizeTestPhone(value) === '593987110032' }
export type TestContact = {
  id: string; phone: string; label: string; fastResponse: boolean; version: number
  leadId: string | null; kommoId: number | null; botEnabled: boolean; matches: number
  blocked: boolean; lastResetAt: string | null
}
export type TestResponseState = { contacts: TestContact[] }
export function testLeadAllowed(config: Record<string, unknown>, leadId: unknown, environmentLead: string | null = null) {
  if (environmentLead && environmentLead !== leadId) return false
  return config.test_only === false || (Array.isArray(config.test_lead_ids)
    ? config.test_lead_ids.includes(leadId) : config.test_lead_id === leadId)
}
