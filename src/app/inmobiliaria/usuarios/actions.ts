'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdmin } from '@/lib/auth/session'
import { normalizeRole } from '@/lib/inmobiliaria/roleAccess'
import type { UserRole } from '@/types/inmobiliaria'

export type ManagedUser = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  role: UserRole
  is_active: boolean
  created_at: string | null
}

export type TourHeatCell = {
  typology: string
  room: string
  unit: string | null
  seconds: number
}

export type TourUserMetrics = {
  profileId: string
  totalSeconds: number
  topTypology: string | null
  topRoom: string | null
  topUnit: string | null
  cells: TourHeatCell[]
}

export type TourGlobalMetrics = {
  activeUsers: number
  totalSeconds: number
  topTypology: string | null
  topRoom: string | null
}

type TourEventRow = {
  seconds: number | null
  room: string | null
  metadata: {
    profile_id?: string
    typology_code?: string | null
    unit_code?: string | null
  } | null
  tour_sessions: { session_id: string | null } | { session_id: string | null }[] | null
}

function sessionIdOf(row: TourEventRow): string | null {
  const session = Array.isArray(row.tour_sessions) ? row.tour_sessions[0] : row.tour_sessions
  return session?.session_id ?? row.metadata?.profile_id ?? null
}

function topKey(counts: Map<string, number>): string | null {
  let best: string | null = null
  let max = 0
  for (const [key, value] of counts) {
    if (value > max) {
      best = key
      max = value
    }
  }
  return best
}

export async function listManagedUsersAction(): Promise<ManagedUser[]> {
  await assertAdmin()
  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('id, full_name, email, phone, role, is_active, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Array<Omit<ManagedUser, 'role'> & { role: string | null }>).map((row) => ({
    ...row,
    role: normalizeRole(row.role),
    is_active: row.is_active !== false,
  }))
}

export async function listTourMetricsAction(): Promise<{
  global: TourGlobalMetrics
  byUser: TourUserMetrics[]
}> {
  await assertAdmin()
  const { data, error } = await createAdminClient()
    .from('tour_events')
    .select('seconds, room, metadata, tour_sessions(session_id)')
    .eq('event_type', 'room_dwell')
  if (error) throw error

  const byUser = new Map<
    string,
    {
      total: number
      typology: Map<string, number>
      room: Map<string, number>
      unit: Map<string, number>
      cells: Map<string, TourHeatCell>
    }
  >()
  const globalTypology = new Map<string, number>()
  const globalRoom = new Map<string, number>()
  let totalSeconds = 0

  for (const row of (data ?? []) as TourEventRow[]) {
    const profileId = sessionIdOf(row)
    const seconds = Math.max(0, Number(row.seconds) || 0)
    if (!profileId || seconds <= 0) continue
    const typology = String(row.metadata?.typology_code ?? '').trim()
    const room = String(row.room ?? '').trim()
    const unit = String(row.metadata?.unit_code ?? '').trim()
    const bucket = byUser.get(profileId) ?? {
      total: 0,
      typology: new Map(),
      room: new Map(),
      unit: new Map(),
      cells: new Map<string, TourHeatCell>(),
    }
    bucket.total += seconds
    if (typology) bucket.typology.set(typology, (bucket.typology.get(typology) ?? 0) + seconds)
    if (room) bucket.room.set(room, (bucket.room.get(room) ?? 0) + seconds)
    if (unit) bucket.unit.set(unit, (bucket.unit.get(unit) ?? 0) + seconds)
    const cellKey = `${typology || '—'}|${room || '—'}`
    const current = bucket.cells.get(cellKey)
    bucket.cells.set(cellKey, {
      typology: typology || '—',
      room: room || '—',
      unit: unit || current?.unit || null,
      seconds: (current?.seconds ?? 0) + seconds,
    })
    byUser.set(profileId, bucket)
    totalSeconds += seconds
    if (typology) globalTypology.set(typology, (globalTypology.get(typology) ?? 0) + seconds)
    if (room) globalRoom.set(room, (globalRoom.get(room) ?? 0) + seconds)
  }

  return {
    global: {
      activeUsers: byUser.size,
      totalSeconds,
      topTypology: topKey(globalTypology),
      topRoom: topKey(globalRoom),
    },
    byUser: [...byUser.entries()].map(([profileId, bucket]) => ({
      profileId,
      totalSeconds: bucket.total,
      topTypology: topKey(bucket.typology),
      topRoom: topKey(bucket.room),
      topUnit: topKey(bucket.unit),
      cells: [...bucket.cells.values()].sort((a, b) => b.seconds - a.seconds),
    })),
  }
}

export async function updateUserRoleAction(userId: string, role: UserRole): Promise<void> {
  const session = await assertAdmin()
  const nextRole = normalizeRole(role)
  if (userId === session.user.id && nextRole !== 'admin') {
    throw new Error('No puedes quitarte el rol de administrador')
  }
  const { error } = await createAdminClient().from('profiles').update({ role: nextRole }).eq('id', userId)
  if (error) throw error
}
