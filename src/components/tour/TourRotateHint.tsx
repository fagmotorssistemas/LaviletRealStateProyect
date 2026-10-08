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
  hidden = false,
}: {
  contained?: boolean
  target?: RefObject<HTMLElement | null>
  inTour?: boolean
  hidden?: boolean
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
    if (hidden || blocked || readKey(storageKey)) {
      setOpen(false)
      return
    }
    setOpen(true)
    const timer = window.setTimeout(() => {
      writeKey(storageKey)
      setOpen(false)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [blocked, hidden, phonePortrait, storageKey])

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

  if (!open || hidden) return null

  return (
    <div
      data-rotate-toast
      className={
        contained
          ? 'pointer-events-none absolute inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-[80] flex justify-center px-3'
          : 'pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-[80] flex justify-center px-3'
      }
    >
      <div className="pointer-events-auto flex max-w-[min(22rem,calc(100%-1.5rem))] items-center gap-2 rounded-full border border-[#bda27e]/55 bg-[#f7f3ee] py-1 pr-1 pl-3 text-[12px] leading-snug text-[#29251e] shadow-md">
        <Smartphone size={16} strokeWidth={1.75} className="shrink-0 text-[#8e7654]" aria-hidden />
        <p className="min-w-0 flex-1">
          {t('Te recomendamos poner el celular en horizontal para una mejor experiencia')}
        </p>
        {landscapeOffer ? (
          <button
            type="button"
            onClick={viewLandscape}
            className="inline-flex h-8 shrink-0 items-center rounded-full bg-[#BDA27E] px-2 text-[10px] font-semibold tracking-[0.06em] text-[#2B1A18] uppercase"
          >
            {t('Ver en horizontal')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#756044]"
          aria-label={t('Cerrar aviso')}
        >
          <X size={14} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  )
}
