/**
 * Contrato de medición Meta — helpers puros (sin I/O).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  META_NEST_BACKEND_PENDING_ERROR,
  META_NEST_OPERATIONAL_EVENTS,
  META_NEST_PENDING_EVENTS,
  buildPurchaseIdempotencyKey,
  buildShowroomGeneralVisitKey,
  buildWishlistIdempotencyKey,
  isMetaNestOperationalEvent,
  isMetaNestPendingEvent,
  labelMetaInternalSubtype,
  nestSupportsEventSend,
  subtypeForEventName,
} from './metaMeasurementContract'

describe('metaMeasurementContract', () => {
  it('separa eventos operativos Nest vs captura pendiente', () => {
    assert.deepEqual([...META_NEST_OPERATIONAL_EVENTS], [
      'ViewContent',
      'Lead',
      'Schedule',
      'LeadSubmitted',
      'AddToWishlist',
    ])
    assert.deepEqual([...META_NEST_PENDING_EVENTS], ['Purchase'])
    assert.equal(isMetaNestOperationalEvent('Lead'), true)
    assert.equal(isMetaNestPendingEvent('AddToWishlist'), false)
    assert.equal(isMetaNestPendingEvent('Purchase'), true)
    assert.equal(isMetaNestPendingEvent('Lead'), false)
    assert.equal(nestSupportsEventSend('ViewContent'), true)
    assert.equal(nestSupportsEventSend('AddToWishlist'), true)
    assert.equal(nestSupportsEventSend('Purchase'), false)
  })

  it('idempotency keys y subtipos internos', () => {
    assert.equal(buildWishlistIdempotencyKey('L1', 'U1'), 'wishlist:L1:U1')
    assert.equal(buildPurchaseIdempotencyKey('S1'), 'purchase:S1')
    assert.equal(buildShowroomGeneralVisitKey('v'), 'view:showroom:v')
    assert.equal(subtypeForEventName('AddToWishlist'), 'favorito')
    assert.equal(subtypeForEventName('Purchase'), 'compra')
    assert.equal(subtypeForEventName('Lead'), 'solicitud')
    assert.equal(labelMetaInternalSubtype('favorito'), 'Favorito')
    assert.equal(labelMetaInternalSubtype('compra'), 'Compra')
    assert.equal(META_NEST_BACKEND_PENDING_ERROR, 'nest_backend_pending')
  })
})
