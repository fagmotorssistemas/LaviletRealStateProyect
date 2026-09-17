/**
 * Schedule enqueue en modo revisión (mocks). Sin outbox ni Meta reales.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import Module from 'node:module'
import ts from 'typescript'

const root = path.resolve(process.cwd())
const require = createRequire(import.meta.url)

function loadEnqueue(mocks: Record<string, unknown>) {
  const filename = path.join(root, 'src/lib/meta/scheduleIntegration.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const m = { exports: {} }
  const localRequire = Module.createRequire(filename)
  const prev = Module._load
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Module._load = function (id: string, parent: any, isMain: boolean) {
    if (id === 'server-only') return {}
    if (id.startsWith('@/')) {
      const mapped = path.join(root, 'src', id.slice(2))
      if (mapped in mocks || id in mocks) return (mocks[id] || mocks[mapped]) as unknown
      // Prefer eligibility real module
      if (id === '@/lib/meta/scheduleEligibility') {
        return localRequire(path.join(root, 'src/lib/meta/scheduleEligibility.ts'))
      }
    }
    if (id in mocks) return mocks[id]
    return prev.call(this, id, parent, isMain)
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', source)(
      (id: string) => {
        if (id === 'server-only') return {}
        if (id === '@/lib/meta/localOutbox') return mocks['@/lib/meta/localOutbox']
        if (id === '@/lib/meta/scheduleEligibility') {
          return require(path.join(root, 'src/lib/meta/scheduleEligibility.ts'))
        }
        if (id in mocks) return mocks[id]
        return localRequire(id)
      },
      m,
      m.exports,
    )
    return m.exports as typeof import('./scheduleIntegration')
  } finally {
    Module._load = prev
  }
}

describe('enqueueScheduleForConfirmedAppointment (revisión)', () => {
  it('WhatsApp elegible con consent: no persiste; reason review_mode_no_persist', async () => {
    let persistCalls = 0
    const { enqueueScheduleForConfirmedAppointment } = loadEnqueue({
      '@/lib/meta/localOutbox': {
        getLeadAdsConsent: async () => true,
        persistMetaConversion: async () => {
          persistCalls += 1
          throw new Error('no debe persistir en revisión')
        },
      },
    })

    const result = await enqueueScheduleForConfirmedAppointment(
      {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                  lead_id: '11111111-2222-4333-8444-555555555555',
                  status: 'aceptado',
                  channel: 'whatsapp',
                  confirmed_by_client: true,
                },
                error: null,
              }),
            }),
          }),
        }),
      } as never,
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'review_mode_no_persist')
    assert.equal(result.eligibility?.actionSource, 'business_messaging')
    assert.equal(persistCalls, 0)
  })

  it('sin consent: skipped; sin persist', async () => {
    let persistCalls = 0
    const { enqueueScheduleForConfirmedAppointment } = loadEnqueue({
      '@/lib/meta/localOutbox': {
        getLeadAdsConsent: async () => null,
        persistMetaConversion: async () => {
          persistCalls += 1
          return { inserted: true, eventId: 'x', rowId: 'y' }
        },
      },
    })

    const result = await enqueueScheduleForConfirmedAppointment(
      {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                  lead_id: '11111111-2222-4333-8444-555555555555',
                  status: 'aceptado',
                  channel: 'web',
                },
                error: null,
              }),
            }),
          }),
        }),
      } as never,
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )

    assert.equal(result.reason, 'ads_consent_missing')
    assert.equal(persistCalls, 0)
  })
})
