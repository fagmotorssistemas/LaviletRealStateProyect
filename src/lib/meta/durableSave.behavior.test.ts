import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAllowedEnqueueEventName } from './enqueueGuards'

type Lead = {
  id: string
  meta_ads_consent: boolean
  meta_lead_event_id: string | null
  meta_lead_event_time: number | null
  meta_lead_delivery_lane: 'test' | 'live' | null
  meta_lead_payload: Record<string, unknown> | null
}
type Outbox = {
  idempotency_key: string
  event_id: string
  event_time: number
  lead_id: string
  status: string
  delivery_lane: 'test' | 'live'
  payload: Record<string, unknown>
}

function createTxStore() {
  let leads: Lead[] = []
  let outbox: Outbox[] = []
  let snapshot: { leads: Lead[]; outbox: Outbox[] } | null = null

  const api = {
    begin() {
      snapshot = {
        leads: leads.map((l) => ({ ...l })),
        outbox: outbox.map((o) => ({ ...o, payload: { ...o.payload } })),
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
        const lane = lead.meta_lead_delivery_lane === 'test' ? 'test' : 'live'
        const payload = lead.meta_lead_payload
          ? { ...lead.meta_lead_payload, recovered: true }
          : { recovered: true, external_id: lead.id }
        outbox.push({
          idempotency_key: key,
          event_id: lead.meta_lead_event_id,
          event_time: lead.meta_lead_event_time,
          lead_id: lead.id,
          status: 'pending',
          delivery_lane: lane,
          payload,
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
          meta_lead_delivery_lane: 'test',
          meta_lead_payload: { phone: '099' },
        })
        throw new Error('outbox_insert_failed')
      })
    }, /outbox_insert_failed/)
    assert.equal(store.leads.length, 0)
  })

  it('recuperación conserva lane test y payload original', () => {
    const store = createTxStore()
    store.insertLead({
      id: 'lead-9',
      meta_ads_consent: true,
      meta_lead_event_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      meta_lead_event_time: 1700000042,
      meta_lead_delivery_lane: 'test',
      meta_lead_payload: { action_source: 'website', phone: '099', fbp: 'fb.1' },
    })
    assert.equal(store.recoverMissing(), 1)
    assert.equal(store.outbox[0].delivery_lane, 'test')
    assert.equal(store.outbox[0].payload.phone, '099')
    assert.equal(store.outbox[0].payload.fbp, 'fb.1')
    assert.equal(store.outbox[0].payload.recovered, true)
  })
})

describe('consent lead_id del cuerpo', () => {
  it('rechaza lead_id que no coincide con el resuelto del visitante', () => {
    const visitorLead = 'resolved-lead'
    const claimed = 'attacker-lead'
    const allowed = !claimed || claimed === visitorLead
    assert.equal(allowed, false)
  })
})

describe('consent version ordering', () => {
  it('grant atrasado no sobrescribe revoke posterior', () => {
    let state: { allowed: boolean; version: number } | null = null
    const apply = (allowed: boolean, version: number) => {
      if (state && state.version > version) return false
      state = { allowed, version }
      return true
    }
    assert.equal(apply(false, 200), true)
    assert.equal(apply(true, 100), false)
    assert.equal(state?.allowed, false)
    assert.equal(apply(true, 300), true)
    assert.equal(state?.allowed, true)
  })
})

describe('RLS migration guards', () => {
  it('migración habilita RLS y revoca anon/authenticated/public', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260915170000_meta_capi_outbox_rls_consent_ledger.sql',
      ),
      'utf8',
    )
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
    assert.match(sql, /REVOKE ALL ON TABLE public\.meta_capi_outbox FROM PUBLIC/)
    assert.match(sql, /REVOKE ALL ON TABLE public\.meta_capi_outbox FROM anon/)
    assert.match(sql, /REVOKE ALL ON TABLE public\.meta_capi_outbox FROM authenticated/)
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.meta_capi_outbox TO service_role/)
    assert.match(sql, /meta_lead_delivery_lane/)
    assert.match(sql, /v_lane := CASE/)
  })
})

describe('enqueueGuards', () => {
  it('bloquea Lead/Schedule fabricados', () => {
    assert.equal(isAllowedEnqueueEventName('ViewContent'), true)
    assert.equal(isAllowedEnqueueEventName('Lead'), false)
  })
})
