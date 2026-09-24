import test from 'node:test'
import assert from 'node:assert/strict'
import { isMetaEventDeliveryEnabled } from './localOutbox'
import { resolveDeliveryLane } from './deliveryLane'

test('vaciado genérico respeta flags de cada evento', () => {
  const off = {} as NodeJS.ProcessEnv
  assert.equal(isMetaEventDeliveryEnabled('ViewContent', off), true)
  assert.equal(isMetaEventDeliveryEnabled('Lead', off), true)
  assert.equal(isMetaEventDeliveryEnabled('Schedule', off), false)
  assert.equal(isMetaEventDeliveryEnabled('LeadSubmitted', off), false)
  assert.equal(isMetaEventDeliveryEnabled('Purchase', off), false)

  assert.equal(isMetaEventDeliveryEnabled('Schedule', {
    META_SCHEDULE_DELIVERY_ENABLED: 'true', META_SCHEDULE_FLUSH: 'true',
  } as NodeJS.ProcessEnv), true)
  assert.equal(isMetaEventDeliveryEnabled('LeadSubmitted', {
    META_WA_LEAD_SUBMITTED_ENABLED: 'true', META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED: 'true',
  } as NodeJS.ProcessEnv), true)
})

test('preview y local nunca caen silenciosamente en live', () => {
  assert.equal(resolveDeliveryLane({ VERCEL_ENV: 'preview', META_CAPI_DELIVERY_LANE: 'live' }), 'test')
  assert.equal(resolveDeliveryLane({ VERCEL_ENV: 'production', META_CAPI_DELIVERY_LANE: 'test' }), 'test')
  assert.equal(resolveDeliveryLane({ VERCEL_ENV: 'production', META_CAPI_DELIVERY_LANE: 'live' }), 'live')
})
