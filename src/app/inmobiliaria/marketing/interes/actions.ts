'use server'

import { assertCanAccessCrmPath } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { TOUR_TENANT_ID } from '@/lib/tour/trackingIds'

const PATH = '/inmobiliaria/marketing/interes'
const TZ = 'America/Guayaquil'

export type InterestPeriod = 'dia' | 'semana' | 'mes'

export type InterestBucketKey = string

export type InterestHeatCell = {
  rowKey: string
  rowLabel: string
  bucket: InterestBucketKey
  /** Puntaje compuesto (visitas + minutos). */
  puntaje: number
  visits: number
  seconds: number
}

export type InterestUnitRow = {
  unitId: string
  unitNumber: string
  category: string | null
  typologyCode: string | null
  floor: string | null
  puntaje: number
  consults: number
  leads: number
  saves: number
}

export type TourInterestHeatmapResult = {
  period: InterestPeriod
  rangeStart: string
  rangeEnd: string
  buckets: { key: InterestBucketKey; label: string }[]
  rows: {
    key: string
    label: string
    totalPuntaje: number
    visits: number
    seconds: number
    /** Ambiente del 360° donde más tiempo se quedó mirando. */
    topAmbiente: string | null
    topAmbienteSeconds: number
  }[]
  cells: InterestHeatCell[]
  units: InterestUnitRow[]
  totals: {
    visits: number
    seconds: number
    typologies: number
    unitsWithInterest: number
  }
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** Instantes de inicio/fin del periodo en America/Guayaquil, como ISO UTC. */
function periodRange(period: InterestPeriod, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  const y = Number(parts.year)
  const m = Number(parts.month)
  const d = Number(parts.day)

  // Mediodía local → ancla estable para armar medianoche Guayaquil vía offset.
  const noonUtcGuess = new Date(Date.UTC(y, m - 1, d, 17, 0, 0))
  const localParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(noonUtcGuess)
      .map((p) => [p.type, p.value]),
  )
  const localHour = Number(localParts.hour)
  const startOfToday = new Date(noonUtcGuess.getTime() - localHour * 3600_000 - Number(localParts.minute) * 60_000)
  startOfToday.setUTCSeconds(0, 0)

  if (period === 'dia') {
    return { start: startOfToday, end: now }
  }

  if (period === 'semana') {
    const weekdayMap: Record<string, number> = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6,
    }
    const wd = weekdayMap[String(parts.weekday)] ?? 0
    const start = new Date(startOfToday.getTime() - wd * 24 * 3600_000)
    return { start, end: now }
  }

  const start = new Date(startOfToday.getTime() - (d - 1) * 24 * 3600_000)
  return { start, end: now }
}

function buildBuckets(period: InterestPeriod, start: Date, end: Date) {
  if (period === 'dia') {
    return Array.from({ length: 24 }, (_, h) => ({
      key: pad2(h),
      label: `${pad2(h)}:00`,
    }))
  }
  if (period === 'semana') {
    const labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    return labels.map((label, i) => ({ key: String(i), label }))
  }
  const monthShort = new Intl.DateTimeFormat('es-EC', {
    timeZone: TZ,
    month: 'short',
  }).format(end)
  const dayCount = Math.min(
    31,
    Math.max(
      1,
      Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: '2-digit' }).format(end)),
    ),
  )
  return Array.from({ length: dayCount }, (_, i) => {
    const day = i + 1
    return { key: pad2(day), label: `${day} ${monthShort}` }
  })
}

function bucketFor(period: InterestPeriod, iso: string): InterestBucketKey | null {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return null
  if (period === 'dia') {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ,
        hour: '2-digit',
        hour12: false,
      }).format(dt),
    )
    return pad2(hour)
  }
  if (period === 'semana') {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(dt)
    const map: Record<string, string> = {
      Mon: '0',
      Tue: '1',
      Wed: '2',
      Thu: '3',
      Fri: '4',
      Sat: '5',
      Sun: '6',
    }
    return map[wd] ?? null
  }
  const day = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: '2-digit' }).format(dt),
  )
  return pad2(day)
}

function typologyFromEvent(row: {
  metadata: Record<string, unknown> | null
  unit_type_id?: string | null
}) {
  const meta = row.metadata ?? {}
  const code = String(meta.typology_code ?? meta.typology ?? '').trim()
  if (code) return code
  return null
}

/** Evita nombres de archivo / slugs técnicos como “ambiente”. */
function isRealAmbiente(room: string | null | undefined) {
  const r = String(room ?? '').trim()
  if (!r || r.length > 48) return false
  if (/gemini|generated|image|\.webp|\.png|\.jpe?g|https?:|piso-\d/i.test(r)) return false
  return true
}

/**
 * Intensidad compuesta:
 * - Recorrido (tipología): visitas ×1 + minutos en escena ×1
 * - Comercial (unidad): consultar ficha ×2 · lead vinculado ×3 · favorito ×4
 */
export async function fetchTourInterestHeatmap(
  period: InterestPeriod = 'semana',
): Promise<{ ok: true; data: TourInterestHeatmapResult } | { ok: false; error: string }> {
  try {
    await assertCanAccessCrmPath(PATH)
    const admin = tryCreateAdminClient()
    if (!admin) {
      return { ok: false, error: 'Falta cliente admin para leer tour_events' }
    }
    const userClient = await createClient()
    const tenantIds = await getAccessibleTenantIds(userClient)
    if (!tenantIds.length) {
      return { ok: false, error: 'Sin tenants accesibles' }
    }

    const { start, end } = periodRange(period)
    const buckets = buildBuckets(period, start, end)
    const startIso = start.toISOString()
    const endIso = end.toISOString()

    const [{ data: tourRows, error: tourError }, { data: unitInterestRows, error: unitError }, { data: units }] =
      await Promise.all([
        admin
          .from('tour_events')
          .select('tour_session_id, event_type, room, seconds, created_at, metadata, unit_type_id')
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .in('event_type', ['entrada', 'ambiente', 'salida', 'consultar_unidad', 'guardar_unidad', 'lead_identificado'])
          .order('created_at', { ascending: true })
          .limit(20000),
        admin
          .from('lead_units')
          .select('unit_id, created_at, source, interest_level')
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .limit(5000),
        admin
          .from('units')
          .select('id, unit_number, category, typology_code, floor, tenant_id')
          .in('tenant_id', tenantIds.includes(TOUR_TENANT_ID) ? tenantIds : [...tenantIds, TOUR_TENANT_ID])
          .eq('is_published', true)
          .limit(500),
      ])

    if (tourError) throw new Error(tourError.message)
    if (unitError) throw new Error(unitError.message)

    const cellMap = new Map<string, InterestHeatCell>()
    const rowAgg = new Map<
      string,
      { label: string; puntaje: number; visits: number; seconds: number }
    >()
    /** tipología → ambiente → segundos */
    const roomByTypology = new Map<string, Map<string, number>>()

    const bumpTypology = (
      typology: string,
      createdAt: string,
      opts: { visits?: number; seconds?: number; puntaje?: number },
    ) => {
      const bucket = bucketFor(period, createdAt)
      if (!bucket) return
      const visits = opts.visits ?? 0
      const seconds = opts.seconds ?? 0
      const puntaje = opts.puntaje ?? visits + seconds / 60
      const cellKey = `${typology}|${bucket}`
      const prev = cellMap.get(cellKey)
      if (prev) {
        prev.visits += visits
        prev.seconds += seconds
        prev.puntaje += puntaje
      } else {
        cellMap.set(cellKey, {
          rowKey: typology,
          rowLabel: typology,
          bucket,
          puntaje,
          visits,
          seconds,
        })
      }
      const row = rowAgg.get(typology) ?? { label: typology, puntaje: 0, visits: 0, seconds: 0 }
      row.puntaje += puntaje
      row.visits += visits
      row.seconds += seconds
      rowAgg.set(typology, row)
    }

    const bumpAmbiente = (typology: string, room: string | null | undefined, seconds: number) => {
      if (!isRealAmbiente(room) || seconds <= 0) return
      const name = String(room).trim()
      const map = roomByTypology.get(typology) ?? new Map<string, number>()
      map.set(name, (map.get(name) ?? 0) + seconds)
      roomByTypology.set(typology, map)
    }

    const lastTypologyBySession = new Map<string, string>()

    for (const raw of tourRows ?? []) {
      const row = raw as {
        tour_session_id: string
        event_type: string
        room: string | null
        seconds: number | null
        created_at: string
        metadata: Record<string, unknown> | null
        unit_type_id: string | null
      }
      const fromMeta = typologyFromEvent(row)
      const sessionId = String(row.tour_session_id ?? '')
      if (fromMeta && sessionId) lastTypologyBySession.set(sessionId, fromMeta)
      const typology = fromMeta || (sessionId ? lastTypologyBySession.get(sessionId) : null) || null
      if (!typology) continue
      const seconds = Math.max(0, Number(row.seconds) || 0)

      if (row.event_type === 'entrada' || row.event_type === 'ambiente') {
        bumpTypology(typology, row.created_at, {
          visits: 1,
          seconds: row.event_type === 'ambiente' ? seconds : 0,
          puntaje: 1 + (row.event_type === 'ambiente' ? seconds / 60 : 0),
        })
        if (row.event_type === 'ambiente') bumpAmbiente(typology, row.room, seconds)
      } else if (row.event_type === 'salida') {
        bumpTypology(typology, row.created_at, {
          visits: 0,
          seconds,
          puntaje: seconds / 60,
        })
        bumpAmbiente(typology, row.room, seconds)
      }
    }

    const unitById = new Map(
      (units ?? []).map((u) => [
        u.id as string,
        {
          id: u.id as string,
          unitNumber: String(u.unit_number),
          category: (u.category as string | null) ?? null,
          typologyCode: (u.typology_code as string | null) ?? null,
          floor: (u.floor as string | null) ?? null,
        },
      ]),
    )

    const unitScores = new Map<
      string,
      { consults: number; leads: number; saves: number; puntaje: number }
    >()

    const bumpUnit = (unitId: string, field: 'consults' | 'leads' | 'saves', points: number) => {
      if (!unitId || !unitById.has(unitId)) return
      const prev = unitScores.get(unitId) ?? { consults: 0, leads: 0, saves: 0, puntaje: 0 }
      prev[field] += 1
      prev.puntaje += points
      unitScores.set(unitId, prev)
    }

    for (const raw of tourRows ?? []) {
      const row = raw as {
        event_type: string
        metadata: Record<string, unknown> | null
        created_at: string
      }
      const meta = row.metadata ?? {}
      const unitId = String(meta.unit_id ?? '').trim()
      if (!unitId) continue
      if (row.event_type === 'consultar_unidad') bumpUnit(unitId, 'consults', 2)
      if (row.event_type === 'guardar_unidad' && meta.action === 'save') bumpUnit(unitId, 'saves', 4)
      if (row.event_type === 'lead_identificado') bumpUnit(unitId, 'leads', 3)
    }

    for (const raw of unitInterestRows ?? []) {
      const unitId = String((raw as { unit_id: string }).unit_id ?? '').trim()
      bumpUnit(unitId, 'leads', 3)
    }

    const topAmbienteOf = (typology: string) => {
      const map = roomByTypology.get(typology)
      if (!map?.size) return { topAmbiente: null as string | null, topAmbienteSeconds: 0 }
      let best = ''
      let bestSec = 0
      for (const [name, sec] of map) {
        if (sec > bestSec) {
          best = name
          bestSec = sec
        }
      }
      return { topAmbiente: best || null, topAmbienteSeconds: bestSec }
    }

    const rows = [...rowAgg.entries()]
      .map(([key, value]) => {
        const top = topAmbienteOf(key)
        return {
          key,
          label: value.label,
          totalPuntaje: Math.round(value.puntaje * 10) / 10,
          visits: value.visits,
          seconds: value.seconds,
          topAmbiente: top.topAmbiente,
          topAmbienteSeconds: top.topAmbienteSeconds,
        }
      })
      .sort((a, b) => b.totalPuntaje - a.totalPuntaje)

    const unitList: InterestUnitRow[] = [...unitScores.entries()]
      .map(([unitId, agg]) => {
        const u = unitById.get(unitId)!
        return {
          unitId,
          unitNumber: u.unitNumber,
          category: u.category,
          typologyCode: u.typologyCode,
          floor: u.floor,
          puntaje: agg.puntaje,
          consults: agg.consults,
          leads: agg.leads,
          saves: agg.saves,
        }
      })
      .sort(
        (a, b) =>
          b.puntaje - a.puntaje || a.unitNumber.localeCompare(b.unitNumber, 'es', { numeric: true }),
      )

    return {
      ok: true,
      data: {
        period,
        rangeStart: startIso,
        rangeEnd: endIso,
        buckets,
        rows,
        cells: [...cellMap.values()],
        units: unitList,
        totals: {
          visits: rows.reduce((s, r) => s + r.visits, 0),
          seconds: rows.reduce((s, r) => s + r.seconds, 0),
          typologies: rows.length,
          unitsWithInterest: unitList.length,
        },
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo cargar el mapa de interés',
    }
  }
}
