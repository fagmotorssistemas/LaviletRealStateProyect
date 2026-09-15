import {
  LV_ADS_CONSENT_COOKIE,
  LV_CONSENT_COOKIE,
  LV_CONTACT_CONSENT_COOKIE,
} from '@/lib/tour/trackingIds'

export const COOKIE_BANNER_ENABLED = process.env.NEXT_PUBLIC_COOKIE_BANNER_ENABLED === 'true'
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? ''

export const LV_CONSENT_MAX_AGE = 180 * 24 * 60 * 60
export const OPEN_COOKIE_PREFERENCES_EVENT = 'lv-open-cookie-preferences'

export type AdsConsentValue = 'full' | 'minimal' | 'denied'
export type CookieConsentValue = 'full' | 'minimal'

function readNamedCookie(name: string) {
  if (typeof document === 'undefined') return ''
  const row = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`))
  return row ? decodeURIComponent(row.split('=').slice(1).join('=')) : ''
}

/** Lee consentimiento publicitario. Valores ambiguos (p.ej. "1") ≠ aceptación de ads. */
export function readAdsConsentCookie(): string {
  const dedicated = readNamedCookie(LV_ADS_CONSENT_COOKIE)
  if (dedicated) return dedicated
  // Migración: solo full/minimal del cookie legacy cuentan como ads.
  const legacy = readNamedCookie(LV_CONSENT_COOKIE)
  if (legacy === 'full' || legacy === 'minimal' || legacy === 'denied') return legacy
  return ''
}

export function readContactConsentCookie(): string {
  return readNamedCookie(LV_CONTACT_CONSENT_COOKIE) || readNamedCookie(LV_CONSENT_COOKIE)
}

export function readConsentCookie() {
  return readAdsConsentCookie()
}

export function hasCookieConsentChoice(value = readAdsConsentCookie()) {
  return value === 'full' || value === 'minimal' || value === 'denied'
}

export function hasAdsConsent(value = readAdsConsentCookie()) {
  return value === 'full'
}

export function writeAdsConsentCookie(value: AdsConsentValue) {
  document.cookie = `${LV_ADS_CONSENT_COOKIE}=${value}; path=/; max-age=${LV_CONSENT_MAX_AGE}; samesite=lax`
  // Mantener legacy alineado solo con elecciones válidas de ads
  document.cookie = `${LV_CONSENT_COOKIE}=${value}; path=/; max-age=${LV_CONSENT_MAX_AGE}; samesite=lax`
}

export function writeContactConsentCookie() {
  document.cookie = `${LV_CONTACT_CONSENT_COOKIE}=1; path=/; max-age=${LV_CONSENT_MAX_AGE}; samesite=lax`
}

/** @deprecated usar writeAdsConsentCookie */
export function writeConsentCookie(value: CookieConsentValue) {
  writeAdsConsentCookie(value)
}

export function revokeAdsConsent() {
  writeAdsConsentCookie('denied')
  window.dispatchEvent(new Event('lv-consent-changed'))
  void fetch('/api/meta/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ads_consent: false }),
    keepalive: true,
  }).catch(() => {})
}

export function openCookiePreferences() {
  window.dispatchEvent(new Event(OPEN_COOKIE_PREFERENCES_EVENT))
}

export function parseAdsConsentFromCookieValue(raw: string | undefined | null): boolean {
  return raw === 'full'
}
