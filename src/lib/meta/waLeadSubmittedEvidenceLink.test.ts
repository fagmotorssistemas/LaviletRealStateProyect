import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { isExplicitPropertyPriceInterest } from './waLeadSubmittedEligibility'
import { linkOrphanEvidenceAndStampCommercialInterest } from './waLeadSubmittedEvidenceLink'

function evidenceQuery(rows: Array<{ content: string; sent_at: string }>) {
  const self: Record<string, unknown> = {}
  const done = Promise.resolve({ data: rows, error: null })
  for (const m of ['select', 'eq', 'is', 'gte', 'order', 'limit']) {
    self[m] = () => self
  }
  // Thenable so `await q` / final chain resolves.
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    done.then(resolve, reject)
  return self
}

describe('linkOrphanEvidenceAndStampCommercialInterest', () => {
  it('sella interés desde evidencia entrante reciente cuando el lead no tiene sello', async () => {
    const updates: Array<Record<string, unknown>> = []
    const priceRow = {
      content: 'cuánto cuesta el departamento?',
      sent_at: new Date().toISOString(),
    }
    let evidenceCalls = 0
    const admin = {
      from(table: string) {
        if (table === 'leads') {
          return {
            select() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return {
                        data: {
                          meta_wa_commercial_interest_at: null,
                          contact_id: '123',
                          kommo_id: 99,
                          tenant_id: 'tenant-1',
                        },
                        error: null,
                      }
                    },
                  }
                },
              }
            },
            update(payload: Record<string, unknown>) {
              updates.push(payload)
              return {
                eq() {
                  return {
                    is() {
                      return Promise.resolve({ error: null })
                    },
                  }
                },
              }
            },
          }
        }
        if (table === 'kommo_message_evidence') {
          evidenceCalls += 1
          // Primera: por lead_id; segunda: huérfanas por contact.
          return evidenceQuery(evidenceCalls === 1 ? [priceRow] : [])
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    const rpc = mock.fn(async () => 3)
    assert.equal(
      isExplicitPropertyPriceInterest('cuánto cuesta el departamento?'),
      true,
    )

    const result = await linkOrphanEvidenceAndStampCommercialInterest({
      admin: admin as never,
      rpc: rpc as never,
      leadId: 'lead-1',
      contactId: '123',
      kommoId: 99,
    })

    assert.equal(result.linked, 3)
    assert.ok(result.stampedAt)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].meta_wa_commercial_interest_at, result.stampedAt)
  })

  it('no pisa un sello existente', async () => {
    const admin = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        meta_wa_commercial_interest_at: '2026-09-25T12:00:00.000Z',
                        contact_id: '123',
                        kommo_id: 99,
                        tenant_id: 'tenant-1',
                      },
                      error: null,
                    }
                  },
                }
              },
            }
          },
        }
      },
    }
    const result = await linkOrphanEvidenceAndStampCommercialInterest({
      admin: admin as never,
      leadId: 'lead-1',
    })
    assert.equal(result.stampedAt, '2026-09-25T12:00:00.000Z')
    assert.equal(result.linked, 0)
  })
})
