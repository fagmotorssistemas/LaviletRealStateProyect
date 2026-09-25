/* eslint-disable @typescript-eslint/no-require-imports */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import fs from 'node:fs'
import ts from 'typescript'

function thenable(data: unknown) {
  return { then(resolve: (value: unknown) => void) { resolve({ data, error: null }) } }
}

function loadFlush(calls: Array<Record<string, unknown>>) {
  const filename = path.resolve(process.cwd(), 'src/lib/meta/localOutbox.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  let attempt = 0
  const loadedModule = { exports: {} }
  new Function('require', 'module', 'exports', source)((id: string) => {
    if (id === 'server-only') return {}
    if (id === 'crypto') return require('node:crypto')
    if (id.includes('capiServer')) return {
      isMetaCapiConfigured: () => true,
      enqueueMetaEvent: async (input: Record<string, unknown>) => {
        calls.push(structuredClone(input))
        attempt += 1
        return attempt === 1 ? { ok: false, skipped: 'network' } : { ok: true, status: 202 }
      },
    }
    if (id.includes('deliveryLane')) return { resolveDeliveryLane: () => 'live' }
    return require(id)
  }, loadedModule, loadedModule.exports)
  return loadedModule.exports as typeof import('./localOutbox')
}

test('el retry QualifiedLead reenvía el snapshot tibio aunque el CRM ya esté caliente', async () => {
  const calls: Array<Record<string, unknown>> = []
  const { flushLocalMetaOutbox } = loadFlush(calls)
  const snapshot = {
    id: 'outbox-1', idempotency_key: 'wa_crm_qualified:lead-1',
    event_id: '11111111-1111-4111-8111-111111111111', event_name: 'QualifiedLead',
    event_time: 1790247601, status: 'pending', delivery_lane: 'live',
    lead_id: 'lead-1', visitor_key: null, ads_consent_required: false,
    payload: {
      action_source: 'business_messaging', messaging_channel: 'whatsapp',
      ctwa_clid: 'ctwa-original', whatsapp_business_account_id: 'waba',
      messaging_dataset_id: 'dataset', tenant_id: 'tenant', project_id: 'project',
      contact_id: 'contact', qualification_source: 'crm_persisted_evaluation',
      temperature: 'tibio', evidence_labels: ['financiamiento'],
    },
  }
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.select = self; chain.eq = self; chain.in = self; chain.order = self
  chain.limit = () => thenable([snapshot])
  chain.update = () => ({ eq: () => thenable(null) })
  const admin = { from: () => chain }
  const previous = process.env.META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED
  process.env.META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED = 'true'
  try {
    const first = await flushLocalMetaOutbox(admin as never, 10)
    assert.equal(first.failed, 1)
    // El CRM cambia, pero el outbox no se reconstruye desde esa ficha actual.
    const currentCrmTemperature = 'caliente'
    assert.equal(currentCrmTemperature, 'caliente')
    const retry = await flushLocalMetaOutbox(admin as never, 10)
    assert.equal(retry.forwarded, 1)
  } finally {
    if (previous == null) delete process.env.META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED
    else process.env.META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED = previous
  }
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], calls[0])
  assert.equal(calls[1].temperature, 'tibio')
  assert.deepEqual(calls[1].evidenceLabels, ['financiamiento'])
  assert.equal(calls[1].eventId, snapshot.event_id)
  assert.equal(calls[1].eventTime, snapshot.event_time)
  assert.equal(calls[1].idempotencyKey, snapshot.idempotency_key)
})
