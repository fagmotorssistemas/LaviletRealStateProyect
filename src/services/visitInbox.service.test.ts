import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { listVisitInbox, visitInboxError } from './visitInbox.service'

const scope = { isAdmin: false, userId: 'advisor-a' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
function client(fetcher: typeof fetch) {
  return createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher },
  })
}

test('network failure makes one request and retains a readable diagnostic', async () => {
  let calls = 0
  const db = client(async () => { calls++; throw new TypeError('Failed to fetch') })
  await assert.rejects(listVisitInbox(db, scope), error => {
    const failure = visitInboxError(error)
    assert.equal(failure.connection, true)
    assert.match(failure.diagnostic, /Failed to fetch/)
    assert.match(failure.message, /automáticamente/)
    return true
  })
  assert.equal(calls, 1)
})

test('relationship fallback preserves advisor, statuses, ordering and limit', async () => {
  const urls: URL[] = []
  const db = client(async input => {
    urls.push(new URL(String(input)))
    return urls.length === 1
      ? response({ code: 'PGRST200', message: 'Could not find relationship in schema cache' }, 400)
      : response([{ id: 'request-a' }])
  })
  assert.deepEqual(await listVisitInbox(db, scope), [{ id: 'request-a' }])
  assert.equal(urls.length, 2)
  for (const url of urls) {
    assert.equal(url.searchParams.get('assigned_advisor_id'), 'eq.advisor-a')
    assert.equal(url.searchParams.get('status'), 'in.(awaiting_advisor,awaiting_client)')
    assert.equal(url.searchParams.get('order'), 'created_at.asc,id.asc')
    assert.equal(url.searchParams.get('limit'), '100')
  }
  assert.equal(urls[1].searchParams.get('select'), '*')
})

test('administrator query does not add an advisor restriction', async () => {
  const db = client(async input => {
    assert.equal(new URL(String(input)).searchParams.has('assigned_advisor_id'), false)
    return response([])
  })
  await listVisitInbox(db, { ...scope, isAdmin: true })
})

test('the queue includes more than twenty requests and reads subsequent pages', async () => {
  const urls: URL[] = []
  const db = client(async input => {
    const url = new URL(String(input)); urls.push(url)
    const offset = Number(url.searchParams.get('offset') || 0)
    return response(Array.from({ length: offset === 0 ? 100 : 3 }, (_, i) => ({ id: `request-${offset + i}` })))
  })
  const items = await listVisitInbox(db, scope)
  assert.equal(items.length, 103)
  assert.equal(items[102].id, 'request-102')
  assert.equal(urls.length, 2)
  assert.equal(urls[1].searchParams.get('offset'), '100')
  for (const url of urls) assert.equal(url.searchParams.get('assigned_advisor_id'), 'eq.advisor-a')
})

test('a failed later page is not presented as a complete queue', async () => {
  let calls = 0
  const db = client(async () => {
    if (++calls === 1) return response(Array.from({ length: 100 }, (_, i) => ({ id: `request-${i}` })))
    throw new TypeError('Failed to fetch')
  })
  await assert.rejects(listVisitInbox(db, scope))
  assert.equal(calls, 2)
})

test('session, permission and missing-table errors are not retried or cached as an empty inbox', async () => {
  for (const code of ['PGRST301', '42501', 'PGRST205']) {
    let calls = 0
    const db = client(async () => ++calls === 1
      ? response({ code, message: 'Cannot read inbox' }, 400) : response([{ id: 'recovered' }]))
    await assert.rejects(listVisitInbox(db, scope), error => {
      assert.match(visitInboxError(error).diagnostic, new RegExp(code))
      return true
    })
    assert.equal(calls, 1)
    assert.deepEqual(await listVisitInbox(db, scope), [{ id: 'recovered' }])
  }
})

test('signed-out users do not query the inbox', async () => {
  const db = client(async () => { assert.fail('Must not fetch') })
  assert.deepEqual(await listVisitInbox(db, { ...scope, userId: '' }), [])
})

test('caller cancellation propagates without a fallback query', async () => {
  const controller = new AbortController()
  let calls = 0
  const db = client(async (_input, init) => {
    calls++
    assert.equal(init?.signal, controller.signal)
    controller.abort()
    throw controller.signal.reason
  })
  await assert.rejects(listVisitInbox(db, { ...scope, signal: controller.signal }))
  assert.equal(calls, 1)
})

test('empty errors and expired sessions have actionable messages', () => {
  assert.equal(visitInboxError({}).diagnostic, 'Error sin detalle')
  assert.match(visitInboxError({ code: 'PGRST301' }).message, /iniciar sesión/)
  assert.equal(visitInboxError(new DOMException('Tiempo agotado', 'TimeoutError')).connection, true)
})
