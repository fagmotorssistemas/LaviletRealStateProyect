import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function readEnv(name: string) {
  const raw = String(process.env[name] ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
  const jwt = raw.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
  return jwt?.[0] ?? raw
}

function jwtClaims(token: string): { role?: string; ref?: string } | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string
      ref?: string
    }
  } catch {
    return null
  }
}

function serviceKeyMatchesProject(url: string, key: string) {
  const claims = jwtClaims(key)
  if (!claims) return true
  if (claims.role && claims.role !== 'service_role') return false
  if (!claims.ref) return true
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === claims.ref || host.startsWith(`${claims.ref}.`)
  } catch {
    return false
  }
}

/** Solo servidor. Nunca leer NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY. */
export function tryCreateAdminClient(): SupabaseClient | null {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  if (!serviceKeyMatchesProject(url, key)) return null
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
