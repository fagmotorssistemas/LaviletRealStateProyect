'use client'

import { createBrowserClient } from '@supabase/ssr'

const REQUEST_TIMEOUT_MS = 15_000

let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (client) return client
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: (input, init) => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

          if (init?.signal) {
            init.signal.addEventListener('abort', () => controller.abort(), { once: true })
          }

          return fetch(input, { ...init, signal: controller.signal })
            .finally(() => clearTimeout(timeoutId))
        },
      },
    }
  )
  return client
}
