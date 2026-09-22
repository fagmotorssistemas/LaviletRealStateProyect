import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveMetaCapiChannel } from './metaCapiChannel'

describe('resolveMetaCapiChannel', () => {
  it('marca web + website_nest sin inventar dataset', () => {
    const r = resolveMetaCapiChannel(
      {
        action_source: 'website',
        event_source_url: 'http://localhost:3000',
      },
      'test',
    )
    assert.equal(r.channel, 'web')
    assert.equal(r.lane, 'test')
    assert.equal(r.destination, 'website_nest')
    assert.equal(r.eventSourceHost, 'localhost:3000')
    assert.equal(r.destinationIdHint, null)
  })

  it('marca WhatsApp solo con evidencia messaging/business_messaging', () => {
    const r = resolveMetaCapiChannel(
      {
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        messaging_dataset_id: '123456789012345',
        ctwa_clid: 'clid-abc',
      },
      'live',
    )
    assert.equal(r.channel, 'whatsapp')
    assert.equal(r.destination, 'messaging_dataset')
    assert.ok(r.destinationIdHint)
    assert.equal(r.hasCtwaClid, true)
    assert.ok(r.ctwaNote?.includes('no implica atribución'))
  })

  it('sin señales → no determinado', () => {
    const r = resolveMetaCapiChannel({}, 'test')
    assert.equal(r.channel, 'undetermined')
    assert.equal(r.destination, 'undetermined')
  })

  it('system_generated solo no implica Web', () => {
    const r = resolveMetaCapiChannel({ action_source: 'system_generated' }, 'live')
    assert.equal(r.channel, 'undetermined')
    assert.match(r.channelLabel, /system_generated/i)
    assert.equal(r.destination, 'undetermined')
  })

  it('website sin URL sigue siendo Web', () => {
    const r = resolveMetaCapiChannel({ action_source: 'website' }, 'live')
    assert.equal(r.channel, 'web')
    assert.equal(r.destination, 'website_nest')
  })

  it('URL sola sin action_source web-like → Web por host (no system_generated)', () => {
    const r = resolveMetaCapiChannel(
      { event_source_url: 'https://www.lavilett.com/tour' },
      'live',
    )
    assert.equal(r.channel, 'web')
    assert.equal(r.eventSourceHost, 'www.lavilett.com')
  })
})
