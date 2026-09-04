import { LV_CONSENT_COOKIE } from '@/lib/tour/trackingIds'

export const COOKIE_BANNER_ENABLED = process.env.NEXT_PUBLIC_COOKIE_BANNER_ENABLED === 'true'
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? ''

export const LV_CONSENT_MAX_AGE = 180 * 24 * 60 * 60
export const OPEN_COOKIE_PREFERENCES_EVENT = 'lv-open-cookie-preferences'

export type CookieConsentValue = 'full' | 'minimal'

export function readConsentCookie() {
  if (typeof document === 'undefined') return ''
  const row = document.cookie.split('; ').find((part) => part.startsWith(`${LV_CONSENT_COOKIE}=`))
  return row ? decodeURIComponent(row.split('=').slice(1).join('=')) : ''
}

export function hasCookieConsentChoice(value = readConsentCookie()) {
  return value === 'full' || value === 'minimal'
}

export function hasAdsConsent(value = readConsentCookie()) {
  return value === 'full'
}

export function writeConsentCookie(value: CookieConsentValue) {
  document.cookie = `${LV_CONSENT_COOKIE}=${value}; path=/; max-age=${LV_CONSENT_MAX_AGE}; samesite=lax`
}

export function openCookiePreferences() {
  window.dispatchEvent(new Event(OPEN_COOKIE_PREFERENCES_EVENT))
}
