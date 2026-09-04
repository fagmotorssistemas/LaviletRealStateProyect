import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function readEnv(name: string) {
  const raw = String(process.env[name] ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
  const jwt = raw.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
  return jwt?.[0] ?? raw
}

function jwtRole(token: string) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: string }
    return json.role ?? null
  } catch {
    return null
  }
}

/** Solo servidor. Nunca importar en componentes client. */
export function tryCreateAdminClient(): SupabaseClient | null {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key =
    readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY') || readEnv('SERVICE_ROLE_KEY')
  if (!url || !key) return null
  const role = jwtRole(key)
  if (role && role !== 'service_role') return null
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
