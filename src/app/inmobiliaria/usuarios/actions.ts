'use server'

import { isAccessPending } from '@/lib/auth/accessPending'
import { tryCreateAdminClient, createAdminClient } from '@/lib/supabase/admin'
import { assertAdmin, getCrmDataClient } from '@/lib/auth/session'
import {
  effectiveCrmPaths,
  knownRole,
  normalizeCrmPaths,
  normalizeRole,
  pathsForRole,
  roleFromCrmPaths,
} from '@/lib/inmobiliaria/roleAccess'
import type { UserRole } from '@/types/inmobiliaria'

export type ManagedUser = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  role: UserRole
  is_active: boolean
  access_pending: boolean
  crm_paths: string[]
  created_at: string | null
}

export type CreateManagedUserInput = {
  full_name: string
  email: string
  phone?: string
  password?: string
  paths: string[]
}

export type CreateManagedUserResult = {
  user: ManagedUser
  temporaryPassword: string
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

function oneTimePassword() {
  return `Lv${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}Aa1!`
}

function pathsFromAuthUser(user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }, role: UserRole) {
  const custom = normalizeCrmPaths(user.app_metadata?.crm_paths)
  if (custom.length > 0) return custom
  return pathsForRole(role)
}

async function loadAuthExtras(admin: ReturnType<typeof createAdminClient>) {
  const pathsById = new Map<string, string[]>()
  const pendingById = new Map<string, boolean>()
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    for (const user of data.users) {
      const role = knownRole(user.user_metadata?.role) ?? 'visitante'
      pathsById.set(user.id, pathsFromAuthUser(user, role))
      pendingById.set(user.id, isAccessPending(user))
    }
    if (data.users.length < 200) break
    page += 1
    if (page > 20) break
  }
  return { pathsById, pendingById }
}

function mapManagedUsers(
  rows: Array<
    Omit<ManagedUser, 'role' | 'email' | 'crm_paths' | 'access_pending'> & {
      role: string | null
      email?: string | null
    }
  >,
  pathsById: Map<string, string[]>,
  pendingById: Map<string, boolean>,
) {
  return rows
    .map((row) => {
      const role = normalizeRole(row.role)
      const access_pending = pendingById.get(row.id) === true
      return {
        ...row,
        email: row.email ?? null,
        role,
        is_active: row.is_active !== false,
        access_pending,
        crm_paths: pathsById.get(row.id) ?? effectiveCrmPaths(role),
      }
    })
    .filter((row) => row.access_pending || row.role !== 'visitante')
    .sort((a, b) => Number(b.access_pending) - Number(a.access_pending))
}

export async function listManagedUsersAction(): Promise<ManagedUser[]> {
  try {
    await assertAdmin()
    const client = await getCrmDataClient()
    const admin = tryCreateAdminClient()
    const extras = admin
      ? await loadAuthExtras(admin)
      : { pathsById: new Map<string, string[]>(), pendingById: new Map<string, boolean>() }

    const withEmail = await client
      .from('profiles')
      .select('id, full_name, email, phone, role, is_active, created_at')
      .order('created_at', { ascending: false })
    if (!withEmail.error) {
      return mapManagedUsers(
        (withEmail.data ?? []) as Array<
          Omit<ManagedUser, 'role' | 'crm_paths' | 'access_pending'> & { role: string | null }
        >,
        extras.pathsById,
        extras.pendingById,
      )
    }

    const withoutEmail = await client
      .from('profiles')
      .select('id, full_name, phone, role, is_active, created_at')
      .order('created_at', { ascending: false })
    if (withoutEmail.error) {
      console.error('listManagedUsersAction', withoutEmail.error.message)
      return []
    }
    return mapManagedUsers(
      (withoutEmail.data ?? []) as Array<
        Omit<ManagedUser, 'role' | 'email' | 'crm_paths' | 'access_pending'> & { role: string | null }
      >,
      extras.pathsById,
      extras.pendingById,
    )
  } catch (error) {
    console.error('listManagedUsersAction', error)
    return []
  }
}

export async function listTourMetricsAction(): Promise<{
  global: TourGlobalMetrics
  byUser: TourUserMetrics[]
}> {
  const empty = {
    global: { activeUsers: 0, totalSeconds: 0, topTypology: null, topRoom: null },
    byUser: [] as TourUserMetrics[],
  }
  try {
    await assertAdmin()
    const { data, error } = await (await getCrmDataClient())
      .from('tour_events')
      .select('seconds, room, metadata, tour_sessions(session_id)')
      .eq('event_type', 'room_dwell')
    if (error) {
      console.error('listTourMetricsAction', error.message)
      return empty
    }

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
  } catch (error) {
    console.error('listTourMetricsAction', error)
    return empty
  }
}

export async function createManagedUserAction(
  input: CreateManagedUserInput,
): Promise<CreateManagedUserResult> {
  await assertAdmin()
  const admin = tryCreateAdminClient()
  if (!admin) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el servidor')

  const fullName = String(input.full_name ?? '').trim()
  const email = String(input.email ?? '').trim().toLowerCase()
  const phone = String(input.phone ?? '').trim() || null
  const paths = normalizeCrmPaths(input.paths)
  const password = String(input.password ?? '').trim() || oneTimePassword()

  if (!fullName) throw new Error('Ingresá el nombre')
  if (!email.includes('@')) throw new Error('Ingresá un correo válido')
  if (paths.length === 0) throw new Error('Seleccioná al menos una vista de acceso')
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres')

  const role = roleFromCrmPaths(paths)
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone, role, access_pending: false },
    app_metadata: { crm_paths: paths, access_pending: false },
  })
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? 'No se pudo crear el usuario')
  }

  const userId = created.data.user.id
  const { error: profileError } = await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name: fullName,
      phone,
      role,
      is_active: true,
    },
    { onConflict: 'id' },
  )
  if (profileError) throw new Error(profileError.message)

  return {
    temporaryPassword: password,
    user: {
      id: userId,
      full_name: fullName,
      email,
      phone,
      role,
      is_active: true,
      access_pending: false,
      crm_paths: paths,
      created_at: new Date().toISOString(),
    },
  }
}

export async function updateUserPathsAction(
  userId: string,
  pathsInput: string[],
): Promise<{ paths: string[]; role: UserRole; access_pending: false }> {
  const session = await assertAdmin()
  const admin = tryCreateAdminClient()
  if (!admin) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el servidor')

  const paths = normalizeCrmPaths(pathsInput)
  if (paths.length === 0) throw new Error('Seleccioná al menos una vista de acceso')

  const role = roleFromCrmPaths(paths)
  if (userId === session.user.id && role !== 'admin') {
    throw new Error('No puedes quitarte el acceso de administrador')
  }
  if (userId === session.user.id && !paths.includes('/inmobiliaria/usuarios')) {
    throw new Error('No puedes quitarte la vista Usuarios')
  }

  const { data: authUser, error: getError } = await admin.auth.admin.getUserById(userId)
  if (getError || !authUser.user) throw new Error(getError?.message ?? 'Usuario no encontrado')

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...authUser.user.app_metadata,
      crm_paths: paths,
      access_pending: false,
    },
    user_metadata: {
      ...authUser.user.user_metadata,
      role,
      access_pending: false,
    },
  })
  if (authError) throw new Error(authError.message)

  const { error } = await admin.from('profiles').update({ role }).eq('id', userId)
  if (error) throw new Error(error.message)
  return { paths, role, access_pending: false }
}

export async function updateUserRoleAction(
  userId: string,
  role: UserRole,
): Promise<{ paths: string[]; role: UserRole; access_pending: false }> {
  const session = await assertAdmin()
  const nextRole = normalizeRole(role)
  if (nextRole === 'visitante') throw new Error('Usá desactivar en lugar de pasar a visitante')
  if (userId === session.user.id && nextRole !== 'admin') {
    throw new Error('No puedes quitarte el rol de administrador')
  }

  const admin = tryCreateAdminClient()
  if (!admin) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el servidor')

  const paths = pathsForRole(nextRole)
  const { data: authUser, error: getError } = await admin.auth.admin.getUserById(userId)
  if (getError || !authUser.user) throw new Error(getError?.message ?? 'Usuario no encontrado')

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...authUser.user.app_metadata,
      crm_paths: paths,
      access_pending: false,
    },
    user_metadata: {
      ...authUser.user.user_metadata,
      role: nextRole,
      access_pending: false,
    },
  })
  if (authError) throw new Error(authError.message)

  const { error } = await admin.from('profiles').update({ role: nextRole }).eq('id', userId)
  if (error) throw new Error(error.message)
  return { paths, role: nextRole, access_pending: false }
}

export async function setUserActiveAction(userId: string, isActive: boolean): Promise<void> {
  const session = await assertAdmin()
  if (userId === session.user.id && !isActive) {
    throw new Error('No puedes desactivar tu propia cuenta')
  }
  const admin = tryCreateAdminClient()
  if (!admin) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el servidor')

  const { error } = await admin.from('profiles').update({ is_active: isActive }).eq('id', userId)
  if (error) throw new Error(error.message)

  // No borramos el usuario de Auth: el historial de leads/ventas sigue asociado al profile id.
  if (!isActive) {
    await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' }).catch(() => undefined)
  } else {
    await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' }).catch(() => undefined)
  }
}
