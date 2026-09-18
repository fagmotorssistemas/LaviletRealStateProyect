import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  fetchMetaOfficialAggregates,
  metaOfficialMetricsCredentialsPresent,
} from './metaOfficialMetrics'

describe('metaOfficialMetrics', () => {
  it('sin credenciales → fuente no disponible (no 0 eventos)', async () => {
    const result = await fetchMetaOfficialAggregates({
      env: {},
      fetchImpl: (async () => {
        throw new Error('no debería llamar a Graph')
      }) as typeof fetch,
    })
    assert.equal(result.available, false)
    assert.match(result.reason, /Fuente no disponible \/ permiso pendiente/)
    assert.deepEqual(result.aggregates, [])
    assert.equal(metaOfficialMetricsCredentialsPresent({}), false)
  })

  it('401/403 → permiso pendiente', async () => {
    const result = await fetchMetaOfficialAggregates({
      env: {
        META_GRAPH_ACCESS_TOKEN: 'tok',
        META_PIXEL_ID: '1234567890',
      },
      fetchImpl: (async () =>
        new Response('forbidden', { status: 403 })) as typeof fetch,
    })
    assert.equal(result.available, false)
    assert.match(result.reason, /permiso pendiente/)
  })

  it('stats OK → agregados separados (no filas individuales)', async () => {
    const result = await fetchMetaOfficialAggregates({
      env: {
        META_MARKETING_ACCESS_TOKEN: 'tok',
        NEXT_PUBLIC_META_PIXEL_ID: '923439043758658',
      },
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            data: [
              { event: 'PageView', count: 37 },
              { event: 'ViewContent', count: 11 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )) as typeof fetch,
    })
    assert.equal(result.available, true)
    if (!result.available) return
    assert.equal(result.aggregates.length, 2)
    assert.equal(result.aggregates[0]?.eventName, 'PageView')
    assert.equal(result.aggregates[0]?.count, 37)
    assert.match(result.note, /No son filas individuales/)
  })
})
