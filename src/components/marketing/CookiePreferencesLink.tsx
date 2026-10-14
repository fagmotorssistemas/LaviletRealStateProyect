'use client'

import { COOKIE_BANNER_ENABLED, openCookiePreferences } from '@/lib/tour/consent'

export function CookiePreferencesLink() {
  if (!COOKIE_BANNER_ENABLED) return null

  return (
    <button
      type="button"
      onClick={openCookiePreferences}
      className="text-xs font-medium text-lv-ink-soft hover:text-lv-ink mkt-dark:text-[#f4efe8]/45 mkt-dark:hover:text-[#f4efe8]"
    >
      Preferencias de cookies
    </button>
  )
}
