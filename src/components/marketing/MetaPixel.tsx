'use client'

import { useEffect, useState } from 'react'
import { META_PIXEL_ID, hasAdsConsent } from '@/lib/tour/consent'

type Fbq = ((...args: unknown[]) => void) & { q?: unknown[][] }

function loadMetaPixel(pixelId: string) {
  const w = window as Window & { fbq?: Fbq; _fbq?: Fbq }
  if (w.fbq) return
  const fbq: Fbq = (...args: unknown[]) => {
    fbq.q = fbq.q ?? []
    fbq.q.push(args)
  }
  w.fbq = fbq
  w._fbq = fbq
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  document.head.appendChild(script)
  fbq('init', pixelId)
  fbq('track', 'PageView')
}

export function MetaPixel() {
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    const sync = () => setAllowed(hasAdsConsent())
    sync()
    window.addEventListener('lv-consent-changed', sync)
    return () => window.removeEventListener('lv-consent-changed', sync)
  }, [])

  useEffect(() => {
    if (!allowed || !META_PIXEL_ID) return
    loadMetaPixel(META_PIXEL_ID)
  }, [allowed])

  if (!allowed || !META_PIXEL_ID) return null

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
