'use client'

import dynamic from 'next/dynamic'
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const PHONE_PREVIEW_KEY = 'lavilet-phone-preview'

const TourViewer = dynamic(
  () => import('@/components/tour/TourViewer').then((mod) => mod.TourViewer),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[320px] w-full bg-black" aria-hidden />,
  },
)

function phonePreviewRequested() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  if (params.get('vista') === 'celular') {
    sessionStorage.setItem(PHONE_PREVIEW_KEY, '1')
    return true
  }
  return sessionStorage.getItem(PHONE_PREVIEW_KEY) === '1'
}

export function TourViewerLoader({ embedded = false }: { embedded?: boolean }) {
  const [phonePreview, setPhonePreview] = useState(false)

  useLayoutEffect(() => {
    if (embedded) return
    const on = phonePreviewRequested()
    document.documentElement.classList.toggle('tour-phone-preview', on)
    setPhonePreview(on)
  }, [embedded])

  const leavePhonePreview = () => {
    sessionStorage.removeItem(PHONE_PREVIEW_KEY)
    document.documentElement.classList.remove('tour-phone-preview')
    const url = new URL(window.location.href)
    url.searchParams.delete('vista')
    window.history.replaceState(null, '', url)
    setPhonePreview(false)
  }

  return (
    <div className={embedded ? 'h-full w-full' : 'h-[min(100dvh,100svh)] w-full'}>
      {phonePreview && typeof document !== 'undefined'
        ? createPortal(
            <div
              data-phone-preview-exit
              className="fixed top-4 left-1/2 z-[400] flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#bda27e]/50 bg-[#14110e] px-3 py-1.5 text-[#f7f3ee] shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
            >
              <span className="text-[11px] font-semibold tracking-[0.14em] uppercase">Vista de celular</span>
              <button
                type="button"
                onClick={leavePhonePreview}
                className="rounded-full bg-[#BDA27E] px-3 py-1.5 text-[11px] font-semibold tracking-[0.08em] text-[#2B1A18] uppercase"
              >
                Ver en computadora
              </button>
            </div>,
            document.body,
          )
        : null}
      <TourViewer embedded={embedded} />
    </div>
  )
}
