'use client'

import { useEffect, useState, type RefObject } from 'react'
import { Smartphone } from 'lucide-react'
import { useTourLanguage } from '@/lib/tour/tourLocale'

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

async function requestFullscreen(el: HTMLElement) {
  const req =
    el.requestFullscreen?.bind(el) ??
    (el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.bind(el)
  const current =
    document.fullscreenElement ??
    (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
  if (!req || current) return
  try {
    await req()
  } catch {
    /* el aviso sigue si el navegador rechaza la pantalla completa */
  }
}

/**
 * Aviso de giro en teléfono vertical. El bloqueo de orientación solo se activa
 * con un toque (botón o el ingreso) y se suelta al salir de pantalla completa.
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
  const [android, setAndroid] = useState(false)

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)')
    const portrait = window.matchMedia('(orientation: portrait)')
    const sync = () => {
      const short = Math.min(window.screen.width, window.screen.height)
      setPhonePortrait(coarse.matches && portrait.matches && short < 600)
      setAndroid(isAndroidPhone())
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

  if (!phonePortrait || locked) return null

  const viewLandscape = () => {
    const el = target?.current ?? document.documentElement
    void (async () => {
      await requestFullscreen(el)
      try {
        const orient = window.screen?.orientation as
          | (ScreenOrientation & { lock?: (mode: string) => Promise<void> })
          | undefined
        if (typeof orient?.lock !== 'function') return
        await orient.lock('landscape')
        setLocked(true)
      } catch {
        /* hace falta el toque y un navegador que permita el bloqueo */
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
      {android ? (
        <button
          type="button"
          onClick={viewLandscape}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#BDA27E] px-6 text-sm font-semibold tracking-[0.12em] text-[#2B1A18] uppercase"
        >
          {t('Ver en horizontal')}
        </button>
      ) : null}
    </div>
  )
}
