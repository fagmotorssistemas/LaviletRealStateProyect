import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ecuadorDayBoundsUtc,
  type TemperatureBucket,
} from './marketingFunnel.service'

/** Réplica mínima del bucketing usado en el informe (sin I/O). */
function bucketTemp(raw: string | null | undefined): TemperatureBucket {
  const t = String(raw || '').trim().toLowerCase()
  if (t === 'frio' || t === 'tibio' || t === 'caliente') return t
  return 'sin_clasificar'
}

function emptyTemp(): Record<TemperatureBucket, number> {
  return { frio: 0, tibio: 0, caliente: 0, sin_clasificar: 0 }
}

describe('marketingFunnel cálculo puro', () => {
  it('temperatura: único + desglose; vacío → sin_clasificar', () => {
    const leads = [
      { id: '1', temperature: 'frio' },
      { id: '2', temperature: 'frio' },
      { id: '3', temperature: null },
      { id: '4', temperature: 'caliente' },
    ]
    const temp = emptyTemp()
    for (const l of leads) temp[bucketTemp(l.temperature)] += 1
    assert.equal(leads.length, 4)
    assert.deepEqual(temp, {
      frio: 2,
      tibio: 0,
      caliente: 1,
      sin_clasificar: 1,
    })
  })

  it('unidades: suma por unidad puede superar leads únicos globales', () => {
    const leadUnits = [
      { lead_id: 'a', unit_id: 'u1' },
      { lead_id: 'a', unit_id: 'u2' },
      { lead_id: 'b', unit_id: 'u1' },
    ]
    const global = new Set(leadUnits.map((r) => r.lead_id)).size
    const perUnit = new Map<string, Set<string>>()
    for (const r of leadUnits) {
      const s = perUnit.get(r.unit_id) || new Set()
      s.add(r.lead_id)
      perUnit.set(r.unit_id, s)
    }
    const sumUnits = [...perUnit.values()].reduce((n, s) => n + s.size, 0)
    assert.equal(global, 2)
    assert.equal(sumUnits, 3)
    assert.ok(sumUnits > global)
  })

  it('citas: filas vs leads distintos; reprogramación no duplica id', () => {
    const appts = [
      { id: '1', lead_id: 'L1', status: 'reprogramado' },
      { id: '1', lead_id: 'L1', status: 'reprogramado' }, // misma cita no debe contar 2 si dedupe por id
      { id: '2', lead_id: 'L1', status: 'cancelado' },
      { id: '3', lead_id: 'L2', status: 'aceptado' },
    ]
    const byId = new Map(appts.map((a) => [a.id, a]))
    const unique = [...byId.values()]
    assert.equal(unique.length, 3)
    assert.equal(new Set(unique.map((a) => a.lead_id)).size, 2)
    assert.equal(unique.filter((a) => a.status === 'reprogramado').length, 1)
    assert.equal(unique.filter((a) => a.status === 'cancelado').length, 1)
  })

  it('límites Ecuador inclusivos', () => {
    const b = ecuadorDayBoundsUtc('2026-09-21', '2026-09-22')
    assert.equal(b.fromIso, '2026-09-21T05:00:00.000Z')
    assert.equal(b.toExclusiveIso, '2026-09-23T05:00:00.000Z')
  })
})
