'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import {
  COOKIE_BANNER_ENABLED,
  OPEN_COOKIE_PREFERENCES_EVENT,
  hasCookieConsentChoice,
  writeConsentCookie,
  type CookieConsentValue,
} from '@/lib/tour/consent'

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!COOKIE_BANNER_ENABLED) return
    setVisible(!hasCookieConsentChoice())
    const open = () => setVisible(true)
    window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, open)
    return () => window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, open)
  }, [])

  if (!COOKIE_BANNER_ENABLED || !visible) return null

  const choose = (value: CookieConsentValue) => {
    writeConsentCookie(value)
    setVisible(false)
    window.dispatchEvent(new Event('lv-consent-changed'))
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl bg-[#2B1A18] px-5 py-4 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2 text-sm leading-relaxed text-white/80">
            <p>Usamos cookies para que el recorrido funcione y para entender qué te interesa.</p>
            <p>
              Guardamos qué ambientes visitas y cuánto tiempo, sin saber quién eres. Si nos dejas tus
              datos, esa información se asocia a tu contacto para poder atenderte mejor.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="shrink-0 rounded-md p-1 text-white/50 hover:text-white"
            aria-label="Cerrar aviso de cookies"
          >
            <X size={16} />
          </button>
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
            onClick={() => choose('minimal')}
            className="h-10 rounded-lg px-4 text-sm text-white/80 ring-1 ring-white/20 hover:text-white"
          >
            Solo lo necesario
          </button>
          <button
            type="button"
            onClick={() => choose('full')}
            className="h-10 rounded-lg bg-[#BDA27E] px-4 text-sm font-medium text-[#2B1A18] hover:bg-[#cbb089]"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  )
}
