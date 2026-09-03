import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  canAccessPath,
  canManageUsers,
  canWriteCrm,
  isAdminRole,
  normalizeRole,
} from '@/lib/inmobiliaria/roleAccess'
import type { UserRole } from '@/types/inmobiliaria'

export type SessionProfile = {
  id: string
  role: UserRole
  full_name: string | null
  email: string | null
}

export async function getSessionUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function getSessionProfile(): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>['user']>
  profile: SessionProfile
} | null> {
  const { supabase, user } = await getSessionUser()
  if (!user) return null
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id, role, full_name, email')
    .eq('id', user.id)
    .maybeSingle()
  return {
    user,
    profile: {
      id: user.id,
      role: normalizeRole(data?.role),
      full_name: data?.full_name ?? user.user_metadata?.full_name ?? null,
      email: data?.email ?? user.email ?? null,
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
  if (!canWriteCrm(session.profile.role)) {
    throw new Error('Tu rol solo permite consultar información')
  }
  return session
}

export async function assertCanAccessCrmPath(pathname: string) {
  const session = await assertLoggedIn()
  if (!canAccessPath(session.profile.role, pathname)) {
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
