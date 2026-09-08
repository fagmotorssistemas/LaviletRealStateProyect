'use server'

import { redirect } from 'next/navigation'
import { ACCESS_PENDING_PATH, isAccessPending } from '@/lib/auth/accessPending'
import { canAccessPath, homePathForRole, knownRole, normalizeCrmPaths } from '@/lib/inmobiliaria/roleAccess'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

function safeNextPath(
  raw: FormDataEntryValue | null,
  role: string | null,
  crmPaths?: string[] | null,
  accessPending?: boolean,
) {
  if (accessPending) return ACCESS_PENDING_PATH
  const value = String(raw ?? '').trim()
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.startsWith('/inmobiliaria') && !canAccessPath(role, value, crmPaths)) return null
  if (value === ACCESS_PENDING_PATH) return null
  return value
}

export type AuthFormState = { error: string } | null

function loginErrorMessage(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('invalid login')) return 'Correo o contraseña incorrectos'
  if (lower.includes('email not confirmed')) return 'Confirma tu correo antes de ingresar'
  if (lower.includes('too many requests')) {
    return 'Demasiados intentos. Espera un momento e inténtalo de nuevo'
  }
  return message
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    return { error: 'Ingresa tu correo y contraseña' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: loginErrorMessage(error.message) }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  let role: string | null = null
  let crmPaths: string[] | null = null
  let accessPending = false
  if (user) {
    accessPending = isAccessPending(user)
    const paths = normalizeCrmPaths(user.app_metadata?.crm_paths)
    crmPaths = paths.length > 0 ? paths : null
    const admin = tryCreateAdminClient()
    const reader = admin ?? supabase
    const { data: profile } = await reader
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (profile && profile.is_active === false) {
      await supabase.auth.signOut()
      return { error: 'Tu cuenta está desactivada. Contactá al administrador.' }
    }

    role = profile?.role ?? null
    if (!knownRole(role) && admin) {
      const { data: adminProfile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      role = adminProfile?.role ?? null
    }
  }

  redirect(
    safeNextPath(formData.get('next'), role, crmPaths, accessPending) ??
      (accessPending ? ACCESS_PENDING_PATH : homePathForRole(role, crmPaths)),
  )
}
