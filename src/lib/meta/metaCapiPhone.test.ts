import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { phoneFromEventPayload, resolveMetaCapiPhone } from './metaCapiPhone'

describe('resolveMetaCapiPhone', () => {
  it('prioriza teléfono del evento y no lo sustituye por CRM', () => {
    const r = resolveMetaCapiPhone({
      eventPhone: '593990011122',
      leadId: 'lead-1',
      leadTenantId: 'tenant-a',
      leadPhone: '0999999999',
      accessibleTenantIds: ['tenant-a'],
    })
    assert.equal(r.source, 'event')
    assert.equal(r.display, '593990011122')
    assert.equal(r.crmPhone, '0999999999')
    assert.equal(r.sourceLabel, 'En el evento')
  })

  it('usa CRM solo con lead_id y tenant autorizado', () => {
    const r = resolveMetaCapiPhone({
      eventPhone: null,
      leadId: 'lead-1',
      leadTenantId: 'tenant-a',
      leadPhone: '0991234567',
      accessibleTenantIds: ['tenant-a'],
    })
    assert.equal(r.source, 'crm_lead')
    assert.equal(r.display, '0991234567')
  })

  it('no usa CRM si el tenant del lead está fuera de alcance', () => {
    const r = resolveMetaCapiPhone({
      eventPhone: null,
      leadId: 'lead-1',
      leadTenantId: 'other-tenant',
      leadPhone: '0991234567',
      accessibleTenantIds: ['tenant-a'],
    })
    assert.equal(r.source, 'none')
    assert.equal(r.display, 'Sin contacto asociado')
    assert.equal(r.crmPhone, null)
  })

  it('sin lead_id ni teléfono de evento → Sin contacto asociado', () => {
    const r = resolveMetaCapiPhone({
      eventPhone: null,
      leadId: null,
      leadTenantId: null,
      leadPhone: '0991234567',
      accessibleTenantIds: ['tenant-a'],
    })
    assert.equal(r.source, 'none')
    assert.equal(r.display, 'Sin contacto asociado')
  })

  it('lee phone del payload del evento', () => {
    assert.equal(phoneFromEventPayload({ phone: '5939 111' }), '5939111')
    assert.equal(phoneFromEventPayload({}), null)
  })
})
