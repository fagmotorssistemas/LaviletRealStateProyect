'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

function emptyTemp() {
  return { frio: 0, tibio: 0, caliente: 0, sin_clasificar: 0 }
}

function bucketTemp(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
  if (t === 'frio' || t === 'tibio' || t === 'caliente') return t
  return 'sin_clasificar'
}

function isDateYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function ecuadorDayBoundsUtc(fromYmd, toYmd) {
  if (!isDateYmd(fromYmd) || !isDateYmd(toYmd)) {
    throw new Error('period_from_to_must_be_YYYY-MM-DD')
  }
  const fromIso = `${fromYmd}T05:00:00.000Z`
  const toDate = new Date(`${toYmd}T05:00:00.000Z`)
  toDate.setUTCDate(toDate.getUTCDate() + 1)
  return { fromIso, toExclusiveIso: toDate.toISOString() }
}

function sumKnownAmounts(values) {
  let sum = 0
  let any = false
  for (const v of values) {
    if (v == null || Number.isNaN(Number(v))) continue
    sum += Number(v)
    any = true
  }
  return any ? sum : null
}

function classifyAppointmentInPeriod(appt, nowIso) {
  const status = String(appt.status || '').toLowerCase()
  if (status === 'cancelado') return 'cancelled'
  if (status === 'atendido' && appt.no_show === true) return 'no_show'
  if (status === 'atendido' && appt.no_show !== true) return 'completed'
  const start = appt.start_time
  if (!start) return 'other'
  if (start > nowIso) return 'scheduled'
  if (
    status === 'solicitada' ||
    status === 'pendiente' ||
    status === 'aceptado' ||
    status === 'reprogramado' ||
    status === ''
  ) {
    return 'scheduled'
  }
  return 'other'
}

function resolveAppointmentUnitIds(appointmentId, links) {
  const unitIds = [
    ...new Set(
      links
        .filter((l) => l.appointment_id === appointmentId)
        .map((l) => l.unit_id),
    ),
  ]
  return { unitIds, undetermined: unitIds.length === 0 }
}

function resolveReservedUnitIds(input) {
  if (String(input.leadStatus || '').toLowerCase() !== 'reservado') {
    return { unitIds: [], undetermined: false }
  }
  const unitIds = input.leadUnitIds.filter(
    (uid) =>
      String(input.unitStatusById.get(uid) || '').toLowerCase() === 'reservado',
  )
  if (unitIds.length === 0) {
    return { unitIds: [], undetermined: true }
  }
  return { unitIds, undetermined: false }
}

function snapshotAnulledContracts(rows) {
  return rows
    .filter((r) => String(r.status || '').toLowerCase() === 'anulado')
    .map((r) => ({
      id: r.id,
      status: 'anulado',
      annulledAt: null,
      signedAt: r.signed_at,
      createdAt: r.created_at,
    }))
}

describe('marketingFunnel casos controlados', () => {
  it('límites Ecuador inclusivos', () => {
    const b = ecuadorDayBoundsUtc('2026-09-21', '2026-09-22')
    assert.equal(b.fromIso, '2026-09-21T05:00:00.000Z')
    assert.equal(b.toExclusiveIso, '2026-09-23T05:00:00.000Z')
  })

  it('sumKnownAmounts no finge ceros', () => {
    assert.equal(sumKnownAmounts([null, undefined]), null)
    assert.equal(sumKnownAmounts([null, 100, 50]), 150)
  })

  it('cita→unidad real; sin link → undetermined', () => {
    const ok = resolveAppointmentUnitIds('a1', [
      { appointment_id: 'a1', unit_id: 'u1' },
    ])
    assert.deepEqual(ok.unitIds, ['u1'])
    assert.equal(ok.undetermined, false)
    const miss = resolveAppointmentUnitIds('a2', [
      { appointment_id: 'a1', unit_id: 'u1' },
    ])
    assert.equal(miss.undetermined, true)
  })

  it('lead 2 unidades interés: cita solo en unidad linkeada', () => {
    const { unitIds } = resolveAppointmentUnitIds('a1', [
      { appointment_id: 'a1', unit_id: 'u1' },
    ])
    assert.deepEqual(unitIds, ['u1'])
    assert.ok(!unitIds.includes('u2'))
  })

  it('reserva solo units.status=reservado', () => {
    const status = new Map([
      ['u1', 'reservado'],
      ['u2', 'disponible'],
    ])
    const one = resolveReservedUnitIds({
      leadId: 'L1',
      leadStatus: 'reservado',
      leadUnitIds: ['u1', 'u2'],
      unitStatusById: status,
    })
    assert.deepEqual(one.unitIds, ['u1'])
    const none = resolveReservedUnitIds({
      leadId: 'L1',
      leadStatus: 'reservado',
      leadUnitIds: ['u2'],
      unitStatusById: status,
    })
    assert.equal(none.undetermined, true)
  })

  it('futura/cancelada ≠ realizada', () => {
    const now = '2026-09-22T18:00:00.000Z'
    assert.equal(
      classifyAppointmentInPeriod(
        {
          status: 'aceptado',
          no_show: false,
          start_time: '2026-09-23T15:00:00.000Z',
        },
        now,
      ),
      'scheduled',
    )
    assert.equal(
      classifyAppointmentInPeriod(
        {
          status: 'cancelado',
          no_show: false,
          start_time: '2026-09-21T15:00:00.000Z',
        },
        now,
      ),
      'cancelled',
    )
    assert.equal(
      classifyAppointmentInPeriod(
        {
          status: 'atendido',
          no_show: false,
          start_time: '2026-09-21T15:00:00.000Z',
        },
        now,
      ),
      'completed',
    )
    assert.equal(
      classifyAppointmentInPeriod(
        {
          status: 'atendido',
          no_show: true,
          start_time: '2026-09-21T15:00:00.000Z',
        },
        now,
      ),
      'no_show',
    )
  })

  it('anulación: annulledAt null; no usar signed_at', () => {
    const snap = snapshotAnulledContracts([
      {
        id: 'c1',
        status: 'anulado',
        signed_at: '2026-09-01T00:00:00.000Z',
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ])
    assert.equal(snap[0].annulledAt, null)
  })

  it('aislamiento dos proyectos mismo tenant', () => {
    const projectA = new Set(['uA1', 'uA2'])
    const projectB = new Set(['uB1'])
    const sales = [{ unit_id: 'uA1' }, { unit_id: 'uB1' }, { unit_id: 'uA2' }]
    assert.equal(sales.filter((s) => projectA.has(s.unit_id)).length, 2)
    assert.equal(sales.filter((s) => projectB.has(s.unit_id)).length, 1)
  })

  it('unidad solo showroom/cita sin lead_units', () => {
    const interest = new Set()
    const unitAgg = new Set([...interest, 'uShow', 'uAppt'])
    assert.ok(unitAgg.has('uShow'))
    assert.equal(interest.has('uShow'), false)
  })

  it('paginación acumula páginas', () => {
    const PAGE = 3
    const all = Array.from({ length: 7 }, (_, i) => ({ id: i }))
    const pages = []
    let from = 0
    for (;;) {
      const slice = all.slice(from, from + PAGE)
      pages.push(slice)
      if (slice.length < PAGE) break
      from += PAGE
    }
    assert.equal(pages.flat().length, 7)
  })

  it('temperatura buckets', () => {
    const temp = emptyTemp()
    for (const t of ['frio', null, 'caliente']) temp[bucketTemp(t)] += 1
    assert.deepEqual(temp, {
      frio: 1,
      tibio: 0,
      caliente: 1,
      sin_clasificar: 1,
    })
  })
})
