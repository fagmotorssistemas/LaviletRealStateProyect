'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  COOKIE_BANNER_ENABLED,
  OPEN_COOKIE_PREFERENCES_EVENT,
  hasCookieConsentChoice,
  persistAdsConsentChoice,
  writeAdsConsentCookie,
  type AdsConsentValue,
} from '@/lib/tour/consent'

/** Aviso automático en landing/marketing; en /tour solo vía Preferencias. */
function isMarketingCookiePath(pathname: string | null) {
  if (!pathname) return false
  if (pathname === '/' || pathname === '/inicio') return true
  return (
    pathname.startsWith('/nosotros') ||
    pathname.startsWith('/proyectos') ||
    pathname.startsWith('/proceso') ||
    pathname.startsWith('/ubicanos') ||
    pathname.startsWith('/contacto') ||
    pathname.startsWith('/simulador') ||
    pathname.startsWith('/privacidad')
  )
}

export function CookieBanner() {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [openedFromPrefs, setOpenedFromPrefs] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (!COOKIE_BANNER_ENABLED) return

    const open = () => {
      setOpenedFromPrefs(true)
      setVisible(true)
    }
    window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, open)
    return () => window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, open)
  }, [])

  useEffect(() => {
    if (!COOKIE_BANNER_ENABLED || !mounted) return
    if (openedFromPrefs) return
    // En /inicio (y marketing): mostrar si aún no eligió.
    setVisible(isMarketingCookiePath(pathname) && !hasCookieConsentChoice())
  }, [mounted, pathname, openedFromPrefs])

  if (!COOKIE_BANNER_ENABLED || !mounted || !visible) return null

  const choose = (value: AdsConsentValue) => {
    writeAdsConsentCookie(value)
    setVisible(false)
    setOpenedFromPrefs(false)
    void import('@/lib/marketing/metaPixel')
      .then((m) => m.applyMetaPixelAdsConsent(value === 'full'))
      .catch((error) => console.error('CookieBanner pixel consent', error))
    window.dispatchEvent(new Event('lv-consent-changed'))
    void persistAdsConsentChoice(value === 'full').catch((error) => {
      console.error('CookieBanner consent persist', error)
    })
  }

  // Portal a body: hermano de .tour-root en immersive (globals.css no lo oculta).
  return createPortal(
    <div
      data-lv-cookie-banner
      className="pointer-events-none fixed inset-x-0 top-0 z-[300] p-3 pt-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))]"
    >
      <div className="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl bg-[#2B1A18] px-5 py-4 text-white shadow-2xl">
        <div className="space-y-2 text-sm leading-relaxed text-white/80">
          <p>
            Usamos cookies para el funcionamiento del sitio y del recorrido virtual. Podés aceptarlas
            todas o quedarte solo con las necesarias.
          </p>
          <p>
            Podés cambiar tu elección cuando quieras desde Preferencias de cookies. Más detalle en
            nuestra política de privacidad.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Link
            href="/privacidad"
            className="h-10 px-3 text-sm text-white/70 underline decoration-white/30 underline-offset-2 hover:text-white"
          >
            Ver política
          </Link>
          <button
            type="button"
            onClick={() => choose('denied')}
            className="h-10 rounded-lg px-4 text-sm text-white/70 hover:text-white"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={() => choose('minimal')}
            className="h-10 rounded-lg px-4 text-sm text-white/80 ring-1 ring-white/20 hover:text-white"
          >
            Solo necesarias
          </button>
          <button
            type="button"
            onClick={() => choose('full')}
            className="h-10 rounded-lg bg-[#BDA27E] px-4 text-sm font-medium text-[#2B1A18] hover:bg-[#cbb089]"
          >
            Aceptar cookies
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
