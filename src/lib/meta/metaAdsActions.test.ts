import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseMetaActions,
  selectPrimaryMetaResult,
} from '@/lib/meta/metaAdsActions'

describe('selectPrimaryMetaResult', () => {
  it('no suma action_types distintos (evita cifra inflada)', () => {
    const primary = selectPrimaryMetaResult([
      { action_type: 'link_click', value: '100' },
      { action_type: 'landing_page_view', value: '80' },
      {
        action_type: 'onsite_conversion.messaging_conversation_started_7d',
        value: '12',
      },
      { action_type: 'page_engagement', value: '490' },
    ])
    assert.ok(primary)
    assert.equal(
      primary!.actionType,
      'onsite_conversion.messaging_conversation_started_7d',
    )
    assert.equal(primary!.value, 12)
    assert.ok(primary!.label.includes('Conversaciones'))
    assert.ok(primary!.otherActionTypes.includes('page_engagement'))
    // Si se sumaran todos serían 682
    assert.notEqual(primary!.value, 682)
  })

  it('sin preferido conocido toma el mayor, sin sumar', () => {
    const primary = selectPrimaryMetaResult([
      { action_type: 'video_view', value: 40 },
      { action_type: 'post_engagement', value: 90 },
    ])
    assert.equal(primary?.actionType, 'post_engagement')
    assert.equal(primary?.value, 90)
  })

  it('parseMetaActions ignora filas inválidas', () => {
    assert.deepEqual(parseMetaActions([{ action_type: 'lead', value: '3' }]), [
      { actionType: 'lead', value: 3 },
    ])
    assert.deepEqual(parseMetaActions(null), [])
  })
})
