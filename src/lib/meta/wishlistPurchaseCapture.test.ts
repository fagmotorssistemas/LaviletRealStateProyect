/**
 * Wishlist / Purchase: flags y skip de flush (sin I/O real a Nest).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import path from 'node:path'
import fs from 'node:fs'
import ts from 'typescript'
import {
  buildPurchaseIdempotencyKey,
  buildWishlistIdempotencyKey,
  isMetaNestPendingEvent,
  isPurchaseMetaSendEnabled,
  META_NEST_BACKEND_PENDING_ERROR,
  nestSupportsEventSend,
} from './metaMeasurementContract'

const OUTBOX_FLUSHABLE_STATUS = 'pending' as const
const OUTBOX_REVIEW_HOLD_STATUS = 'review_hold' as const
function isOutboxStatusFlushable(status: string | null | undefined): boolean {
  return String(status || '') === OUTBOX_FLUSHABLE_STATUS
}

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
      if (id.includes('deliveryLane')) {
        return { resolveDeliveryLane: () => 'live' }
      }
      if (id.includes('metaMeasurementContract')) {
        return require('./metaMeasurementContract')
      }
      return require(id)
    },
    m,
    m.exports,
  )
  return m.exports as typeof import('./localOutbox')
}

describe('purchase / wishlist capture flags', () => {
  it('isPurchaseMetaSendEnabled es false salvo META_PURCHASE_DELIVERY_ENABLED=true', () => {
    const prev = process.env.META_PURCHASE_DELIVERY_ENABLED
    try {
      delete process.env.META_PURCHASE_DELIVERY_ENABLED
      assert.equal(isPurchaseMetaSendEnabled(), false)
      process.env.META_PURCHASE_DELIVERY_ENABLED = 'false'
      assert.equal(isPurchaseMetaSendEnabled(), false)
      process.env.META_PURCHASE_DELIVERY_ENABLED = 'true'
      assert.equal(isPurchaseMetaSendEnabled(), true)
    } finally {
      if (prev === undefined) delete process.env.META_PURCHASE_DELIVERY_ENABLED
      else process.env.META_PURCHASE_DELIVERY_ENABLED = prev
    }
  })

  it('Nest soporta AddToWishlist; Purchase sigue pendiente de delivery', () => {
    assert.equal(nestSupportsEventSend('AddToWishlist'), true)
    assert.equal(nestSupportsEventSend('Purchase'), false)
    assert.equal(isMetaNestPendingEvent('AddToWishlist'), false)
    assert.equal(isMetaNestPendingEvent('Purchase'), true)
    assert.equal(buildWishlistIdempotencyKey('a', 'b'), 'wishlist:a:b')
    assert.equal(buildPurchaseIdempotencyKey('sale'), 'purchase:sale')
    assert.equal(META_NEST_BACKEND_PENDING_ERROR, 'nest_backend_pending')
    assert.equal(isOutboxStatusFlushable(OUTBOX_REVIEW_HOLD_STATUS), false)
    assert.equal(isOutboxStatusFlushable(OUTBOX_FLUSHABLE_STATUS), true)
  })

  it('flushLocalMetaOutbox encola AddToWishlist; no Purchase aunque pending', async () => {
    const enqueueCalls: unknown[] = []
    const { flushLocalMetaOutbox } = loadFlushWithMockEnqueue(enqueueCalls)

    const rows = [
      {
        id: 'w',
        idempotency_key: 'wishlist:l:u',
        event_id: '11111111-1111-4111-8111-111111111111',
        event_name: 'AddToWishlist',
        event_time: 1,
        payload: {
          action_source: 'website',
          lv_internal_subtype: 'favorito',
          unit_id: '33333333-3333-4333-8333-333333333333',
        },
        status: OUTBOX_FLUSHABLE_STATUS,
        delivery_lane: 'live',
        lead_id: 'lead-1',
        visitor_key: 'v1',
        ads_consent_required: false,
      },
      {
        id: 'p',
        idempotency_key: 'purchase:s',
        event_id: '22222222-2222-4222-8222-222222222222',
        event_name: 'Purchase',
        event_time: 1,
        payload: { action_source: 'website', value: 100 },
        status: OUTBOX_FLUSHABLE_STATUS,
        delivery_lane: 'live',
        lead_id: 'lead-1',
        visitor_key: null,
        ads_consent_required: false,
      },
      {
        id: 'ok',
        idempotency_key: 'lead:x',
        event_id: '33333333-3333-4333-8333-333333333333',
        event_name: 'Lead',
        event_time: 1,
        payload: { action_source: 'website' },
        status: OUTBOX_FLUSHABLE_STATUS,
        delivery_lane: 'live',
        lead_id: null,
        visitor_key: null,
        ads_consent_required: false,
      },
    ]

    const admin = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      order() {
                        return {
                          limit() {
                            return thenable(rows)
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
          update() {
            return {
              eq() {
                return thenable(null)
              },
            }
          },
        }
      },
    }

    const result = await flushLocalMetaOutbox(admin as never, { limit: 10 })
    assert.equal(result.forwarded, 2)
    assert.equal(result.skipped, 1)
    assert.equal(enqueueCalls.length, 2)
    const names = enqueueCalls.map((c) => (c as { eventName: string }).eventName).sort()
    assert.deepEqual(names, ['AddToWishlist', 'Lead'])
  })
})
