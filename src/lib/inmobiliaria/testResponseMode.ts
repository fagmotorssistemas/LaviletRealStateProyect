export const TEST_RESPONSE_SETTING = 'automation_test_response_mode'
export const TEST_RESPONSE_PHONE = '0987110032'
export const TEST_RESPONSE_SECONDS = 5
export function isTestPhone(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits === '0987110032' || digits === '593987110032'
}
export type TestResponseState = { enabled: boolean; version: number; leadId: string; kommoId: number; botEnabled: boolean }
