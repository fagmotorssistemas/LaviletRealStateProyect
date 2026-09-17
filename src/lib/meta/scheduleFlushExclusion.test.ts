/**
 * Flush local: excluye review_hold (cola activa = pending solamente).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import path from 'node:path'
import fs from 'node:fs'
import ts from 'typescript'
import {
  isOutboxStatusFlushable,
  OUTBOX_FLUSHABLE_STATUS,
  OUTBOX_REVIEW_HOLD_STATUS,
} from './localOutbox'

const root = path.resolve(process.cwd())

function thenable(data: unknown) {
  return {
    then(resolve: (v: unknown) => void) {
      resolve({ data, error: null })
    },
  }
}

function loadFlushWithMockEnqueue(enqueueCalls: unknown[]) {
  const filename = path.join(root, 'src/lib/meta/localOutbox.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const m = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', source)(
    (id: string) => {
      if (id === 'server-only') return {}
      if (id === 'crypto') return require('node:crypto')
      if (id.includes('capiServer')) {
        return {
          isMetaCapiConfigured: () => true,
          enqueueMetaEvent: async (input: unknown) => {
            enqueueCalls.push(input)
            return { ok: true, status: 202 }
          },
        }
      }
      return require(id)
    },
    m,
    m.exports,
  )
  return m.exports as typeof import('./localOutbox')
}

describe('flushLocalMetaOutbox vs review_hold', () => {
  it('no reenvía review_hold aunque el result set las incluya; Nest no las recibe', async () => {
    const enqueueCalls: unknown[] = []
    const { flushLocalMetaOutbox } = loadFlushWithMockEnqueue(enqueueCalls)

    const rows = [
      {
        id: 'rh',
        idempotency_key: 'schedule:a',
        event_id: '11111111-1111-4111-8111-111111111111',
        event_name: 'Schedule',
        event_time: 1,
        payload: { action_source: 'website', phone: '5939' },
        status: OUTBOX_REVIEW_HOLD_STATUS,
        delivery_lane: 'live',
        lead_id: null,
        visitor_key: null,
        ads_consent_required: false,
      },
      {
        id: 'p',
        idempotency_key: 'lead:x',
        event_id: '22222222-2222-4222-8222-222222222222',
        event_name: 'Lead',
        event_time: 1,
        payload: { action_source: 'website', phone: '5939' },
        status: OUTBOX_FLUSHABLE_STATUS,
        delivery_lane: 'live',
        lead_id: null,
        visitor_key: null,
        ads_consent_required: false,
      },
    ]

    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.select = self
    chain.eq = self
    chain.in = self
    chain.order = self
    chain.limit = () => thenable(rows)
    chain.update = () => {
      const u: Record<string, unknown> = {}
      u.eq = () => thenable(null)
      return u
    }

    const supabase = {
      from: () => chain,
    }

    process.env.META_CAPI_DELIVERY_LANE = 'live'
    const result = await flushLocalMetaOutbox(supabase as never, 20)
    assert.equal(result.forwarded, 1)
    assert.equal(result.skipped, 1)
    assert.equal(enqueueCalls.length, 1)
    assert.equal((enqueueCalls[0] as { eventName: string }).eventName, 'Lead')
    assert.equal(isOutboxStatusFlushable(OUTBOX_REVIEW_HOLD_STATUS), false)
  })
})
