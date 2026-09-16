'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import {
  COOKIE_BANNER_ENABLED,
  hasAdsConsent,
  META_PIXEL_ID,
  META_PIXEL_SIMULATE,
} from '@/lib/tour/consent'
import {
  applyMetaPixelAdsConsent,
  ensureMetaPixel,
  isMetaPublicPath,
  trackMetaPixelEvent,
} from '@/lib/marketing/metaPixel'

/**
 * PageView en rutas públicas con consentimiento ads.
 * Init + autoConfig=false viven en metaPixel.ts (compartido con ViewContent/Lead).
 * Con META_PIXEL_SIMULATE no carga scripts ni pixel.gif de Facebook.
 */
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
    applyMetaPixelAdsConsent(true)
    ensureMetaPixel(META_PIXEL_ID)
    if (lastPageView.current === path) return
    lastPageView.current = path
    trackMetaPixelEvent('PageView')
  }

  useEffect(() => {
    const onConsent = () => {
      if (!hasAdsConsent()) {
        applyMetaPixelAdsConsent(false)
        lastPageView.current = ''
        return
      }
      emitPageViewOnce(pathname)
    }
    window.addEventListener('lv-consent-changed', onConsent)
    return () => window.removeEventListener('lv-consent-changed', onConsent)
  }, [pathname])

  useEffect(() => {
    if (!hasAdsConsent()) {
      applyMetaPixelAdsConsent(false)
      return
    }
    emitPageViewOnce(pathname)
  }, [pathname])

  if (!META_PIXEL_ID || !isMetaPublicPath(pathname)) return null
  if (!hasAdsConsent()) return null
  if (META_PIXEL_SIMULATE) return null

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
