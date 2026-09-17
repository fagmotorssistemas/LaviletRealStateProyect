import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isProductionMetaRuntime, resolveDeliveryLane } from './deliveryLane'

describe('resolveDeliveryLane', () => {
  it('fuera de production fuerza test aunque pidan live', () => {
    assert.equal(
      resolveDeliveryLane({
        VERCEL_ENV: 'preview',
        META_CAPI_DELIVERY_LANE: 'live',
        META_MODE: 'live',
      }),
      'test',
    )
    assert.equal(
      resolveDeliveryLane({
        VERCEL_ENV: 'development',
        META_CAPI_DELIVERY_LANE: 'live',
      }),
      'test',
    )
    assert.equal(resolveDeliveryLane({ NODE_ENV: 'development' }), 'test')
  })

  it('production respeta META_CAPI_DELIVERY_LANE y META_MODE', () => {
    assert.equal(
      resolveDeliveryLane({ VERCEL_ENV: 'production', META_CAPI_DELIVERY_LANE: 'test' }),
      'test',
    )
    assert.equal(
      resolveDeliveryLane({ VERCEL_ENV: 'production', META_MODE: 'test' }),
      'test',
    )
    assert.equal(resolveDeliveryLane({ VERCEL_ENV: 'production' }), 'live')
  })

  it('isProductionMetaRuntime solo VERCEL_ENV=production', () => {
    assert.equal(isProductionMetaRuntime({ VERCEL_ENV: 'production' }), true)
    assert.equal(isProductionMetaRuntime({ VERCEL_ENV: 'preview' }), false)
    assert.equal(isProductionMetaRuntime({ NODE_ENV: 'production' }), false)
  })
})
