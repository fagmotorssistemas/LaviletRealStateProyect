import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { fetchWithTimeout } from './request'

export async function createClient(options: { requestTimeoutMs?: number } = {}) {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(options.requestTimeoutMs === undefined ? {} : {
        global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetchWithTimeout(input, init, options.requestTimeoutMs) },
      }),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — ignore
          }
        },
      },
    }
  )
}
