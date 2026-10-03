'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { Smartphone, X } from 'lucide-react'
import { useTourLanguage } from '@/lib/tour/tourLocale'

const WELCOME_KEY = 'lavilet-portrait-toast'
const TOUR_KEY = 'lavilet-portrait-toast-tour'

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

function canLockLandscape() {
  const orient = window.screen?.orientation as { lock?: unknown } | undefined
  return typeof orient?.lock === 'function' && document.fullscreenEnabled === true
}

function readKey(key: string) {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeKey(key: string) {
  try {
    sessionStorage.setItem(key, '1')
  } catch {
    /* la sesión igual puede seguir */
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
  if (!req) throw new Error('fullscreen')
  await req()
}

/**
 * Aviso breve en vertical. No tapa el showroom: se cierra solo, al girar
 * o con la X. Una vez al entrar y otra al abrir el tour 360.
 */
export function TourRotateHint({
  contained = false,
  target,
  inTour = false,
}: {
  contained?: boolean
  target?: RefObject<HTMLElement | null>
  inTour?: boolean
}) {
  const { t } = useTourLanguage()
  const [phonePortrait, setPhonePortrait] = useState(false)
  const [landscapeOffer, setLandscapeOffer] = useState(false)
  const [open, setOpen] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const openRef = useRef(false)
  openRef.current = open
  const storageKey = inTour ? TOUR_KEY : WELCOME_KEY

  useEffect(() => {
    const root = target?.current ?? document.querySelector('.tour-root')
    if (!root) return
    const sync = () => {
      setBlocked(Boolean(root.querySelector('[role="dialog"], .tour-ficha-sheet, .tour-modal-sheet')))
    }
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'role', 'open'] })
    return () => obs.disconnect()
  }, [target])

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)')
    const portrait = window.matchMedia('(orientation: portrait)')
    const sync = () => {
      const short = Math.min(window.screen.width, window.screen.height)
      setPhonePortrait(coarse.matches && portrait.matches && short < 700)
      setLandscapeOffer(isAndroidPhone() && !isInAppBrowser() && canLockLandscape())
    }
    sync()
    coarse.addEventListener('change', sync)
    portrait.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      coarse.removeEventListener('change', sync)
      portrait.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [])

  useEffect(() => {
    if (!phonePortrait) {
      if (openRef.current) writeKey(storageKey)
      setOpen(false)
      return
    }
    if (blocked || readKey(storageKey)) {
      setOpen(false)
      return
    }
    setOpen(true)
    const timer = window.setTimeout(() => {
      writeKey(storageKey)
      setOpen(false)
    }, 6000)
    return () => window.clearTimeout(timer)
  }, [blocked, phonePortrait, storageKey])

  const dismiss = () => {
    writeKey(storageKey)
    setOpen(false)
  }

  const viewLandscape = () => {
    const el = target?.current ?? document.documentElement
    void (async () => {
      try {
        await requestFullscreen(el)
        const orient = window.screen?.orientation as
          | (ScreenOrientation & { lock?: (mode: string) => Promise<void> })
          | undefined
        if (typeof orient?.lock !== 'function') throw new Error('orientation')
        await orient.lock('landscape')
        dismiss()
      } catch {
        console.info(navigator.userAgent)
        setLandscapeOffer(false)
      }
    })()
  }

  if (!open) return null

  return (
    <div
      data-rotate-toast
      className={
        contained
          ? 'pointer-events-none absolute bottom-[max(4.75rem,calc(env(safe-area-inset-bottom)+3.75rem))] left-[max(0.75rem,env(safe-area-inset-left))] z-[180] flex'
          : 'pointer-events-none fixed bottom-[max(4.75rem,calc(env(safe-area-inset-bottom)+3.75rem))] left-[max(0.75rem,env(safe-area-inset-left))] z-[180] flex'
      }
    >
      <div className="pointer-events-auto flex w-[min(16rem,calc(100vw-6.75rem))] flex-col gap-2 overflow-hidden rounded-2xl border border-[#bda27e]/40 bg-[#14110e]/92 px-3 py-2 text-[#f7f3ee] shadow-[0_10px_28px_rgba(0,0,0,0.38)]">
        <div className="flex items-start gap-2">
          <Smartphone size={22} strokeWidth={1.75} className="tour-phone-rock mt-1 shrink-0 text-[#bda27e]" aria-hidden />
          <p className="min-w-0 flex-1 text-[12px] leading-snug">
            {t('Te recomendamos poner el celular en horizontal para una mejor experiencia')}
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#f7f3ee]/80"
            aria-label={t('Cerrar aviso')}
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>
        {landscapeOffer ? (
          <button
            type="button"
            onClick={viewLandscape}
            className="inline-flex min-h-10 items-center self-start rounded-full bg-[#BDA27E] px-3 text-[10px] font-semibold tracking-[0.08em] text-[#2B1A18] uppercase"
          >
            {t('Ver en horizontal')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
