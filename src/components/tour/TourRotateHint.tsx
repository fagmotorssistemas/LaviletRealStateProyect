'use client'

import { useEffect, useState, type RefObject } from 'react'
import { Smartphone } from 'lucide-react'
import { useTourLanguage } from '@/lib/tour/tourLocale'

const PORTRAIT_OK_KEY = 'lavilet-portrait-ok'

function isIOSWebKit() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function isAndroidPhone() {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent || '') && !isIOSWebKit()
}

function isInAppBrowser() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
  return /Instagram|FBAN|FBAV|WhatsApp|Line/i.test(ua)
}

function isSocialInApp() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
  return /Instagram|FBAN|FBAV|WhatsApp/i.test(ua)
}

function readPortraitOk() {
  try {
    return sessionStorage.getItem(PORTRAIT_OK_KEY) === '1'
  } catch {
    return false
  }
}

async function requestFullscreen(el: HTMLElement) {
  const current =
    document.fullscreenElement ??
    (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
  if (current) return
  const req =
    el.requestFullscreen?.bind(el) ??
    (el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.bind(el)
  if (!req) {
    const error = new Error('Fullscreen API unavailable')
    error.name = 'NotSupportedError'
    throw error
  }
  await req()
}

/**
 * Aviso de giro en teléfono vertical. El bloqueo de orientación solo se activa
 * con un toque y se suelta al salir de pantalla completa. «Continuar en vertical»
 * oculta el aviso durante la sesión.
 */
export function TourRotateHint({
  contained = false,
  target,
}: {
  contained?: boolean
  target?: RefObject<HTMLElement | null>
}) {
  const { t } = useTourLanguage()
  const [phonePortrait, setPhonePortrait] = useState(false)
  const [locked, setLocked] = useState(false)
  const [landscapeOffer, setLandscapeOffer] = useState(false)
  const [socialInApp, setSocialInApp] = useState(false)
  const [landscapeError, setLandscapeError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(readPortraitOk())
    const coarse = window.matchMedia('(pointer: coarse)')
    const portrait = window.matchMedia('(orientation: portrait)')
    const sync = () => {
      const short = Math.min(window.screen.width, window.screen.height)
      setPhonePortrait(coarse.matches && portrait.matches && short < 600)
      setSocialInApp(isSocialInApp())
      setLandscapeOffer(isAndroidPhone() && !isInAppBrowser())
    }
    sync()
    coarse.addEventListener('change', sync)
    portrait.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    const onFullscreen = () => {
      const current =
        document.fullscreenElement ??
        (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
      if (!current) setLocked(false)
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    document.addEventListener('webkitfullscreenchange', onFullscreen)
    const onLocked = () => setLocked(true)
    window.addEventListener('lavilet-orientation-locked', onLocked)
    return () => {
      coarse.removeEventListener('change', sync)
      portrait.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('webkitfullscreenchange', onFullscreen)
      window.removeEventListener('lavilet-orientation-locked', onLocked)
    }
  }, [])

  if (!phonePortrait || locked || dismissed) return null

  const continuePortrait = () => {
    try {
      sessionStorage.setItem(PORTRAIT_OK_KEY, '1')
    } catch {
      /* la sesión igual sigue en vertical */
    }
    setDismissed(true)
  }

  const viewLandscape = () => {
    const el = target?.current ?? document.documentElement
    void (async () => {
      try {
        await requestFullscreen(el)
      } catch (error) {
        const name = error instanceof Error && error.name ? error.name : 'Error'
        console.warn('No se pudo pedir pantalla completa', error)
        setLandscapeError(name)
        return
      }
      try {
        const orient = window.screen?.orientation as
          | (ScreenOrientation & { lock?: (mode: string) => Promise<void> })
          | undefined
        if (typeof orient?.lock !== 'function') {
          const error = new Error('Screen Orientation API unavailable')
          error.name = 'NotSupportedError'
          throw error
        }
        await orient.lock('landscape')
        setLocked(true)
        setLandscapeError(null)
      } catch (error) {
        const name = error instanceof Error && error.name ? error.name : 'Error'
        console.warn('No se pudo bloquear la orientación', error)
        setLandscapeError(name)
      }
    })()
  }

  return (
    <div
      className={
        contained
          ? 'absolute inset-0 z-[180] flex flex-col items-center justify-center gap-4 bg-[#14110e] px-8 text-center text-[#f7f3ee]'
          : 'fixed inset-0 z-[180] flex flex-col items-center justify-center gap-4 bg-[#14110e] px-8 text-center text-[#f7f3ee]'
      }
    >
      <Smartphone size={42} strokeWidth={1.5} className="text-[#bda27e]" aria-hidden />
      <p className="max-w-xs font-serif text-2xl leading-snug">{t('Gira tu teléfono para ver el showroom')}</p>
      {socialInApp ? (
        <p className="max-w-xs text-xs leading-snug text-[#f7f3ee]/80">
          {t('Abre esta página en Chrome para verla en horizontal')}
        </p>
      ) : landscapeOffer ? (
        <>
          <button
            type="button"
            onClick={viewLandscape}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#BDA27E] px-6 text-sm font-semibold tracking-[0.12em] text-[#2B1A18] uppercase"
          >
            {t('Ver en horizontal')}
          </button>
          {landscapeError ? <p className="text-[11px] text-[#f7f3ee]/70">{landscapeError}</p> : null}
        </>
      ) : null}
      <button
        type="button"
        onClick={continuePortrait}
        className="text-xs text-[#bda27e] underline underline-offset-4"
      >
        {t('Continuar en vertical')}
      </button>
    </div>
  )
}
