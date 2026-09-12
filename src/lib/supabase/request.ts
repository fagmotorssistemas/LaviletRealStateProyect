/** Preserve caller cancellation while limiting requests that stop responding. */
export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 15_000) {
  const controller = new AbortController()
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  if (callerSignal?.aborted) throw callerSignal.reason
  const cancel = () => controller.abort(callerSignal?.reason)
  callerSignal?.addEventListener('abort', cancel, { once: true })
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('La solicitud superó el tiempo de espera', 'TimeoutError'))
  }, timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
    callerSignal?.removeEventListener('abort', cancel)
  }
}
