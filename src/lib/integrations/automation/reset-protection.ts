// No production override. Test-only reset functions run inside isolated fixtures.
export function assertProductionRpcAllowed(name: string): void {
  if (/^(lv_reset_lavilet_|lv_test_reset$)/i.test(name)) {
    throw new Error('DESTRUCTIVE_TEST_RESET_DISABLED')
  }
}

export function assertProductionRequestAllowed(input: RequestInfo | URL): void {
  const raw = input instanceof Request ? input.url : String(input)
  const pathname = new URL(raw, 'http://localhost').pathname
  const match = pathname.match(/\/rest\/v1\/rpc\/([^/]+)\/?$/i)
  if (match) assertProductionRpcAllowed(decodeURIComponent(match[1]))
}
