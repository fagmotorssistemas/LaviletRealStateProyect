'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import {
  COOKIE_BANNER_ENABLED,
  hasAdsConsent,
  META_PIXEL_ID,
} from '@/lib/tour/consent'
import { isMetaPublicPath, trackMetaPixelEvent } from '@/lib/marketing/metaPixel'

declare global {
  interface Window {
    fbq?: FbqFn
    _fbq?: FbqFn
    __lvMetaPixelInitialized?: string
  }
}

type FbqFn = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  loaded?: boolean
  version?: string
  push?: (...args: unknown[]) => void
}

/**
 * Stub oficial de Meta Pixel (callMethod / queue).
 * Evita reinits en Strict Mode y navegación cliente.
 */
function ensureMetaPixel(pixelId: string) {
  if (typeof window === 'undefined') return
  if (window.__lvMetaPixelInitialized === pixelId && typeof window.fbq === 'function') {
    return
  }

  const f = window
  if (!f.fbq) {
    const n = function (...args: unknown[]) {
      const fbq = n as FbqFn
      if (fbq.callMethod) {
        fbq.callMethod(...args)
      } else {
        fbq.queue.push(args)
      }
    } as FbqFn
    n.queue = []
    n.loaded = true
    n.version = '2.0'
    n.push = n
    f.fbq = n
    if (!f._fbq) f._fbq = n
  }

  const existing = document.querySelector<HTMLScriptElement>('script[data-lv-meta-pixel="1"]')
  if (!existing) {
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://connect.facebook.net/en_US/fbevents.js'
    script.dataset.lvMetaPixel = '1'
    const first = document.getElementsByTagName('script')[0]
    first?.parentNode?.insertBefore(script, first)
  }

  if (window.__lvMetaPixelInitialized !== pixelId) {
    window.fbq?.('init', pixelId)
    window.__lvMetaPixelInitialized = pixelId
  }
}

function shouldTrackPixel(pathname: string) {
  if (!META_PIXEL_ID || !isMetaPublicPath(pathname)) return false
  if (COOKIE_BANNER_ENABLED && !hasAdsConsent()) return false
  if (!COOKIE_BANNER_ENABLED && !hasAdsConsent()) return false
  return true
}

export function MetaPixel() {
  const pathname = usePathname() || ''
  const lastPageView = useRef('')

  const emitPageViewOnce = (path: string) => {
    if (!shouldTrackPixel(path)) return
    ensureMetaPixel(META_PIXEL_ID)
    if (lastPageView.current === path) return
    lastPageView.current = path
    trackMetaPixelEvent('PageView')
  }

  useEffect(() => {
    const onConsent = () => {
      // Consentimiento en la página actual: PageView sin duplicar el path ya emitido.
      emitPageViewOnce(pathname)
    }
    window.addEventListener('lv-consent-changed', onConsent)
    return () => window.removeEventListener('lv-consent-changed', onConsent)
  }, [pathname])

  useEffect(() => {
    emitPageViewOnce(pathname)
  }, [pathname])

  if (!META_PIXEL_ID || !isMetaPublicPath(pathname)) return null
  if (!hasAdsConsent()) return null

  return (
    <noscript>
      <img
        height="1"
        width="1"
        className="hidden"
        alt=""
        src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
      />
    </noscript>
  )
}
