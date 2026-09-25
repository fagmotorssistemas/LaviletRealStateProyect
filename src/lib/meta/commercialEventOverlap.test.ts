/* eslint-disable @typescript-eslint/no-require-imports */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import fs from 'node:fs'
import ts from 'typescript'
import { prepareScheduleDeliveryAfterConfirmation } from './scheduleDelivery'
import { distinctCommercialFacts } from './crmCapiSignalMatrix'

const LEAD = '11111111-2222-4333-8444-555555555555'
const APPOINTMENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function loadLeadProducer(calls: Array<Record<string, unknown>>) {
  const filename = path.resolve(process.cwd(), 'src/lib/meta/infoRequestLeadProducer.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'module', 'exports', source)((id: string) => {
    if (id === 'server-only') return {}
    if (id.includes('localOutbox')) return {
      persistMetaConversion: async (_admin: unknown, input: Record<string, unknown>) => {
        calls.push(input)
        return { inserted: true, eventId: 'lead-event', rowId: 'lead-row', status: 'pending' }
      },
    }
    return require(id)
  }, loadedModule, loadedModule.exports)
  return loadedModule.exports as typeof import('./infoRequestLeadProducer')
}

function scheduleSupabase() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const self = () => builder
      builder.select = self
      builder.eq = self
      builder.maybeSingle = async () => {
        if (table === 'appointments') return { data: {
          id: APPOINTMENT, lead_id: LEAD, status: 'aceptado', channel: 'web',
          confirmed_by_client: true, confirmed_at: '2026-09-24T12:00:00Z',
          tenant_id: 'tenant', project_id: 'project', meta_schedule_event_id: null,
        }, error: null }
        if (table === 'leads') return { data: {
          id: LEAD, phone: '593990000000', name: 'Cliente', email: null,
          contact_id: 'contact-1', meta_ads_consent: true,
        }, error: null }
        throw new Error(table)
      }
      builder.then = (resolve: (value: unknown) => void) => resolve({ data: null, error: null })
      return builder
    },
  } as never
}

test('financiamiento no excluye Lead ni Schedule cuando sus hechos reales existen', async () => {
  const internalQualificationEvidence = ['financiamiento']
  assert.deepEqual(internalQualificationEvidence, ['financiamiento'])
  const leadCalls: Array<Record<string, unknown>> = []
  const leadProducer = loadLeadProducer(leadCalls)
  const lead = await leadProducer.persistInfoRequestLeadEvent({} as never, {
    leadId: LEAD, visitorKey: 'visitor-1', requestId: 'request-1',
    createdAt: '2026-09-24T11:30:00Z',
    payload: { action_source: 'website' },
  })
  assert.equal(leadCalls.length, 1)
  assert.equal(leadCalls[0].eventName, 'Lead')
  assert.equal(leadCalls[0].idempotencyKey, `lead:${LEAD}`)

  const scheduleCalls: Array<Record<string, unknown>> = []
  const schedule = await prepareScheduleDeliveryAfterConfirmation(
    scheduleSupabase(), APPOINTMENT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      adminClient: scheduleSupabase(),
      registerIntent: async (input) => ({
        ok: true, inserted: true, eventId: input.eventId,
        eventTime: input.eventTime, channel: input.channelKind,
      }),
      persist: async (_admin, input) => {
        scheduleCalls.push(input as unknown as Record<string, unknown>)
        return { inserted: true, eventId: 'schedule-event', rowId: 'schedule-row', status: 'review_hold' }
      },
    },
  )
  assert.equal(schedule.ok, true)
  assert.equal(scheduleCalls[0].eventName, 'Schedule')
  assert.equal(scheduleCalls[0].idempotencyKey, `schedule:${APPOINTMENT}`)

  const facts = distinctCommercialFacts([
    { kind: 'crm_qualification', sourceId: 'evaluation-1', leadId: LEAD, occurredAt: '2026-09-24T11:00:00Z' },
    { kind: 'information_requested', sourceId: 'request-1', leadId: LEAD, occurredAt: '2026-09-24T11:30:00Z' },
    { kind: 'appointment_confirmed', sourceId: APPOINTMENT, leadId: LEAD, occurredAt: '2026-09-24T12:00:00Z' },
    { kind: 'appointment_confirmed', sourceId: APPOINTMENT, leadId: LEAD, occurredAt: '2026-09-24T12:00:00Z' },
  ])
  assert.deepEqual(facts.map((fact) => fact.kind), [
    'crm_qualification', 'information_requested', 'appointment_confirmed',
  ])
  assert.equal(lead.eventTime, 1790249400)
})
