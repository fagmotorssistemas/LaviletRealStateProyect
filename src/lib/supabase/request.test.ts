import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithTimeout } from './request'

test('already cancelled requests never reach the network', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new Response('ok'))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetchWithTimeout('https://example.com', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(fetcher.mock.callCount(), 0)
})

test('cancellation interrupts a pending request and preserves its reason', async t => {
  const controller = new AbortController()
  const reason = new DOMException('Changed session', 'AbortError')
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    controller.abort(reason)
  }))
  await assert.rejects(fetchWithTimeout('https://example.com', { signal: controller.signal }), error => error === reason)
})

test('a timeout is distinguishable from caller cancellation', async t => {
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }))
  await assert.rejects(fetchWithTimeout('https://example.com', undefined, 10), { name: 'TimeoutError' })
})

test('completed requests release the caller abort listener', async t => {
  const controller = new AbortController()
  const remove = t.mock.method(controller.signal, 'removeEventListener')
  t.mock.method(globalThis, 'fetch', async () => new Response('ok'))
  assert.equal(await (await fetchWithTimeout('https://example.com', { signal: controller.signal })).text(), 'ok')
  assert.equal(remove.mock.callCount(), 1)
})

test('cancellation carried by a Request object is honored', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new Response('ok'))
  const controller = new AbortController()
  const request = new Request('https://example.com', { signal: controller.signal })
  controller.abort()
  await assert.rejects(fetchWithTimeout(request), { name: 'AbortError' })
  assert.equal(fetcher.mock.callCount(), 0)
})
