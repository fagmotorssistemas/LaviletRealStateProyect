import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  canAccessPath,
  canManageUsers,
  isAdminRole,
  knownRole,
} from '@/lib/inmobiliaria/roleAccess'
import type { UserRole } from '@/types/inmobiliaria'

export type SessionProfile = {
  id: string
  role: UserRole | null
  full_name: string | null
  email: string | null
}

export type SessionProfileRow = {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: UserRole | null
  phone: string | null
  email: string | null
}

type ProfileQueryRow = {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  phone: string | null
}

const OWN_PROFILE_COLUMNS = 'id, full_name, avatar_url, role, phone'

export async function getSessionUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

function mapOwnProfile(
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>['user']>,
  row: ProfileQueryRow | null,
): SessionProfileRow {
  return {
    id: user.id,
    full_name: row?.full_name ?? user.user_metadata?.full_name ?? null,
    avatar_url: row?.avatar_url ?? null,
    role: knownRole(row?.role) ?? knownRole(user.user_metadata?.role),
    phone: row?.phone ?? user.user_metadata?.phone ?? null,
    email: user.email ?? null,
  }
}

export async function readOwnProfileRow(): Promise<SessionProfileRow | null> {
  try {
    const { supabase, user } = await getSessionUser()
    if (!user) return null

    const fromUser = await supabase
      .from('profiles')
      .select(OWN_PROFILE_COLUMNS)
      .eq('id', user.id)
      .maybeSingle()

    const userRow = (fromUser.data as ProfileQueryRow | null) ?? null
    if (userRow && knownRole(userRow.role)) {
      return mapOwnProfile(user, userRow)
    }

    const admin = tryCreateAdminClient()
    if (admin) {
      const fromAdmin = await admin
        .from('profiles')
        .select(OWN_PROFILE_COLUMNS)
        .eq('id', user.id)
        .maybeSingle()
      if (!fromAdmin.error && fromAdmin.data) {
        return mapOwnProfile(user, fromAdmin.data as ProfileQueryRow)
      }
    }

    return mapOwnProfile(user, userRow)
  } catch (error) {
    console.error('readOwnProfileRow', error)
    return null
  }
}

export async function getCrmDataClient() {
  return tryCreateAdminClient() ?? (await getSessionUser()).supabase
}

export async function getSessionProfile(): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>['user']>
  profile: SessionProfile
} | null> {
  const { user } = await getSessionUser()
  if (!user) return null
  const row = await readOwnProfileRow()
  return {
    user,
    profile: {
      id: user.id,
      role: row?.role ?? knownRole(user.user_metadata?.role),
      full_name: row?.full_name ?? user.user_metadata?.full_name ?? null,
      email: row?.email ?? user.email ?? null,
    },
  }
}

export async function assertLoggedIn() {
  const session = await getSessionProfile()
  if (!session) throw new Error('No autenticado')
  return session
}

export async function assertCanWriteCrm() {
  const session = await assertLoggedIn()
  if (knownRole(session.profile.role) === 'visitante') {
    throw new Error('Tu rol solo permite consultar información')
  }
  return session
}

export async function assertCanAccessCrmPath(pathname: string) {
  const session = await assertLoggedIn()
  const role = knownRole(session.profile.role)
  if (role === 'visitante' || (role && !canAccessPath(role, pathname))) {
    throw new Error('No tienes acceso a esta sección')
  }
  return session
}

export async function assertAdmin() {
  const session = await assertLoggedIn()
  if (!isAdminRole(session.profile.role) || !canManageUsers(session.profile.role)) {
    throw new Error('Solo el administrador puede hacer esto')
  }
  return session
}
