'use client'

import { COOKIE_BANNER_ENABLED, openCookiePreferences } from '@/lib/tour/consent'

export function CookiePreferencesLink() {
  if (!COOKIE_BANNER_ENABLED) return null

  return (
    <button
      type="button"
      onClick={openCookiePreferences}
      className="text-xs font-medium text-[#2B1A18]/45 hover:text-[#2B1A18]"
    >
      Preferencias de cookies
    </button>
  )
}
