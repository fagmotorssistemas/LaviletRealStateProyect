import assert from 'node:assert/strict'
import test from 'node:test'
import {
  homeListingContentParams,
  isMetaCoreSetupConservativeEnv,
  META_HOME_LISTING_CONTENT_TYPE,
} from './homeListingContent'

test('content_ids = unit UUID y content_type = home_listing', () => {
  const id = '7945f316-b72f-4b59-a15b-cf4241979f7f'
  const params = homeListingContentParams(id, { unitNumber: '001' })
  assert.deepEqual(params, {
    content_ids: [id],
    content_type: META_HOME_LISTING_CONTENT_TYPE,
    content_name: 'Unidad 001',
  })
  assert.equal(params?.content_type, 'home_listing')
})

test('rechaza ids no UUID (no inventa content_ids)', () => {
  assert.equal(homeListingContentParams('001'), null)
  assert.equal(homeListingContentParams(''), null)
})

test('Core Setup conservador sigue activo por defecto', () => {
  assert.equal(isMetaCoreSetupConservativeEnv({}), true)
  assert.equal(isMetaCoreSetupConservativeEnv({ NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE: 'true' }), true)
  assert.equal(isMetaCoreSetupConservativeEnv({ META_CORE_SETUP_CONSERVATIVE: 'false' }), false)
})
