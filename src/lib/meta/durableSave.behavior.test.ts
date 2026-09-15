import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAllowedEnqueueEventName } from './enqueueGuards'

type Lead = {
  id: string
  meta_ads_consent: boolean
  meta_lead_event_id: string | null
  meta_lead_event_time: number | null
}
type Outbox = {
  idempotency_key: string
  event_id: string
  event_time: number
  lead_id: string
  status: string
}

/** Mini-store transaccional en memoria (simula Postgres RPC). */
function createTxStore() {
  let leads: Lead[] = []
  let outbox: Outbox[] = []
  let snapshot: { leads: Lead[]; outbox: Outbox[] } | null = null

  const api = {
    begin() {
      snapshot = {
        leads: leads.map((l) => ({ ...l })),
        outbox: outbox.map((o) => ({ ...o })),
      }
    },
    commit() {
      snapshot = null
    },
    rollback() {
      if (!snapshot) return
      leads = snapshot.leads
      outbox = snapshot.outbox
      snapshot = null
    },
    runAtomic(fn: () => void) {
      api.begin()
      try {
        fn()
        api.commit()
      } catch (error) {
        api.rollback()
        throw error
      }
    },
    insertLead(lead: Lead) {
      leads.push(lead)
    },
    insertOutbox(row: Outbox) {
      if (outbox.some((o) => o.idempotency_key === row.idempotency_key)) {
        throw new Error('outbox_conflict')
      }
      outbox.push(row)
    },
    get leads() {
      return leads
    },
    get outbox() {
      return outbox
    },
    recoverMissing() {
      let n = 0
      for (const lead of leads) {
        if (!lead.meta_ads_consent || !lead.meta_lead_event_id || !lead.meta_lead_event_time) {
          continue
        }
        const key = `lead:${lead.id}`
        if (outbox.some((o) => o.idempotency_key === key)) continue
        outbox.push({
          idempotency_key: key,
          event_id: lead.meta_lead_event_id,
          event_time: lead.meta_lead_event_time,
          lead_id: lead.id,
          status: 'pending',
        })
        n += 1
      }
      return n
    },
  }
  return api
}

describe('guardado durable lead+outbox (comportamiento)', () => {
  it('si falla el outbox dentro de la TX, el lead también se revierte', () => {
    const store = createTxStore()
    assert.throws(() => {
      store.runAtomic(() => {
        store.insertLead({
          id: 'lead-1',
          meta_ads_consent: true,
          meta_lead_event_id: 'evt-1',
          meta_lead_event_time: 1700000000,
        })
        throw new Error('outbox_insert_failed')
      })
    }, /outbox_insert_failed/)
    assert.equal(store.leads.length, 0)
    assert.equal(store.outbox.length, 0)

    store.runAtomic(() => {
      store.insertLead({
        id: 'lead-1',
        meta_ads_consent: true,
        meta_lead_event_id: 'evt-1',
        meta_lead_event_time: 1700000000,
      })
      store.insertOutbox({
        idempotency_key: 'lead:lead-1',
        event_id: 'evt-1',
        event_time: 1700000000,
        lead_id: 'lead-1',
        status: 'pending',
      })
    })
    assert.equal(store.leads.length, 1)
    assert.equal(store.outbox.length, 1)
  })

  it('recuperación recrea outbox con event_id/time originales sin tráfico nuevo', () => {
    const store = createTxStore()
    store.insertLead({
      id: 'lead-9',
      meta_ads_consent: true,
      meta_lead_event_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      meta_lead_event_time: 1700000042,
    })
    assert.equal(store.recoverMissing(), 1)
    assert.equal(store.outbox[0].event_id, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    assert.equal(store.outbox[0].event_time, 1700000042)
    assert.equal(store.outbox[0].status, 'pending')
    assert.equal(store.recoverMissing(), 0)
  })
})

describe('enqueueGuards', () => {
  it('bloquea Lead/Schedule fabricados en /api/meta/enqueue', () => {
    assert.equal(isAllowedEnqueueEventName('ViewContent'), true)
    assert.equal(isAllowedEnqueueEventName('Lead'), false)
    assert.equal(isAllowedEnqueueEventName('Schedule'), false)
  })
})
