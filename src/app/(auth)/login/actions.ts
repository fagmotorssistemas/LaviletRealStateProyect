'use server'

import { isAccessPending } from '@/lib/auth/accessPending'
import { loginDestination, loginErrorMessage, LOGIN_RETRY_MESSAGE, type LoginState } from '@/lib/auth/login-result'
import { normalizeCrmPaths } from '@/lib/inmobiliaria/roleAccess'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export type AuthFormState = LoginState

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    return { error: 'Ingresa tu correo y contraseña' }
  }

  let supabase: Awaited<ReturnType<typeof createClient>> | null = null
  let authenticated = false
  let stage = 'authenticate'
  try {
    supabase = await createClient({ requestTimeoutMs: 12_000 })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: loginErrorMessage(error) }

    // This user was verified by the password endpoint; another getUser adds a round trip.
    authenticated = true
    const user = data.user
    if (!user || !data.session) throw new Error('Login session unavailable')
    stage = 'profile'
    const accessPending = isAccessPending(user)
    const paths = normalizeCrmPaths(user.app_metadata?.crm_paths)
    const crmPaths = paths.length > 0 ? paths : null
    const admin = tryCreateAdminClient({ requestTimeoutMs: 8_000 })
    const reader = admin ?? supabase
    const { data: profile, error: profileError } = await reader
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .abortSignal(AbortSignal.timeout(8_000))
      .maybeSingle()

    if (profileError) throw new Error('Login profile unavailable')
    if (profile && profile.is_active === false) {
      await supabase.auth.signOut({ scope: 'local' })
      return { error: 'Tu cuenta está desactivada. Contactá al administrador.' }
    }

    return { destination: loginDestination(formData.get('next'), profile?.role ?? null, crmPaths, accessPending) }
  } catch {
    // Do not log credentials, tokens or provider error bodies.
    console.error('login_failed', { stage })
    if (authenticated && supabase) {
      try { await supabase.auth.signOut({ scope: 'local' }) }
      catch { console.error('login_session_cleanup_failed') }
    }
    return { error: LOGIN_RETRY_MESSAGE }
  }
}
