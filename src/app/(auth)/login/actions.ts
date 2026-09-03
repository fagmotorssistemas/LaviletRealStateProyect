'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canAccessPath, homePathForRole, knownRole } from '@/lib/inmobiliaria/roleAccess'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

function safeNextPath(raw: FormDataEntryValue | null, role: string | null) {
  const value = String(raw ?? '').trim()
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.startsWith('/inmobiliaria') && !canAccessPath(role, value)) return null
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
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    role = profile?.role ?? null
    if (!knownRole(role)) {
      const { data: adminProfile } = await createAdminClient()
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      role = adminProfile?.role ?? null
    }
  }

  revalidatePath('/', 'layout')
  redirect(safeNextPath(formData.get('next'), role) ?? homePathForRole(role))
}
