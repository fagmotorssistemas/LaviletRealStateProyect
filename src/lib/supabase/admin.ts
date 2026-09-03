import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Solo servidor. Nunca importar en componentes client. */
export function tryCreateAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createAdminClient() {
  const client = tryCreateAdminClient()
  if (!client) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  }
  return client
}
