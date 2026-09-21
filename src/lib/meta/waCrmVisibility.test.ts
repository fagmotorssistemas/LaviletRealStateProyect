import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  attributionStatusForContact,
  buildContactDetails,
  dedupeInboundMessages,
  maskCtwaClid,
  summarizeWaCrmPeriod,
} from './waCrmVisibility'
import { matchTechnicalProbeMessage } from './waCrmTechnicalProbes'
import { getAdsInsightsStatus } from './adsInsightsStatus'

describe('waCrmVisibility', () => {
  it('deduplica por external_message_id', () => {
    const rows = dedupeInboundMessages([
      { id: '1', externalMessageId: 'ext-a' },
      { id: '2', externalMessageId: 'ext-a' },
      { id: '3', externalMessageId: null },
      { id: '3', externalMessageId: null },
    ])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].id, '1')
    assert.equal(rows[1].id, '3')
  })

  it('CTWA solo por tabla attribution, no por source WHATSAPP', () => {
    const keys = new Set(['proj:9431328'])
    assert.equal(
      attributionStatusForContact({ contactId: '9431328', projectId: 'proj', ctwaKeys: keys }),
      'confirmed',
    )
    assert.equal(
      attributionStatusForContact({ contactId: '9431328', projectId: 'other', ctwaKeys: keys }),
      'not_confirmed',
    )
  })

  it('marca prueba técnica solo en el mensaje de la ventana, no el contacto entero', () => {
    const hit = matchTechnicalProbeMessage({
      kommoId: 4453096,
      contactId: 9431328,
      sentAt: '2026-09-21T14:52:30.000Z',
    })
    assert.ok(hit)
    assert.equal(hit!.id, 'external_property_ad_2026-09-21_0952_ec')

    const hit1158 = matchTechnicalProbeMessage({
      kommoId: 4453096,
      contactId: 9431328,
      sentAt: '2026-09-21T16:58:58.000Z',
    })
    assert.ok(hit1158)
    assert.equal(hit1158!.id, 'external_property_ad_2026-09-21_1158_ec')

    const missSameContact = matchTechnicalProbeMessage({
      kommoId: 4453096,
      contactId: 9431328,
      sentAt: '2026-09-22T14:52:30.000Z',
    })
    assert.equal(missSameContact, null)
  })

  it('buildContactDetails resume inbound y no inventa CTWA', () => {
    const details = buildContactDetails({
      leads: [
        {
          id: 'lead-1',
          name: 'Pablo',
          phone: '099',
          kommo_id: 4453096,
          contact_id: '9431328',
          project_id: 'proj',
          tenant_id: 'ten',
          source: 'whatsapp',
          channel_origin: 'whatsapp',
        },
      ],
      inboundByLead: new Map([
        [
          'lead-1',
          [
            {
              id: 'm1',
              conversationId: 'c1',
              leadId: 'lead-1',
              role: 'cliente',
              sentAt: '2026-09-21T14:52:30.000Z',
              externalMessageId: 'ext-1',
              contentPreview: 'hola',
            },
          ],
        ],
      ]),
      ctwaKeys: new Set(),
    })
    assert.equal(details.length, 1)
    assert.equal(details[0].attributionStatus, 'not_confirmed')
    assert.equal(details[0].crmOriginLabel.includes('whatsapp'), true)
    assert.ok(details[0].technicalProbe)
    assert.match(details[0].leadHref, /lead=lead-1/)

    const summary = summarizeWaCrmPeriod(details, 1)
    assert.equal(summary.inboundMessages, 1)
    assert.equal(summary.contactsWithoutCtwa, 1)
    assert.equal(summary.contactsWithCtwa, 0)
  })

  it('maskCtwaClid nunca devuelve el valor completo largo', () => {
    const masked = maskCtwaClid('Aff-SECRET-LONG-CLID-VALUE-12345')
    assert.ok(masked)
    assert.equal(masked!.includes('SECRET-LONG'), false)
  })
})

describe('adsInsightsStatus', () => {
  it('no inventa ceros conectados', () => {
    const status = getAdsInsightsStatus()
    assert.equal(status.connected, false)
    assert.equal(status.message, 'Métricas publicitarias no conectadas')
    assert.ok(status.missing.length >= 3)
  })
})
