'use client'

import { useEffect, useRef } from 'react'
import { TourSafeArea } from '@/components/tour/TourSafeArea'
import { cn } from '@/lib/utils'

const HEADER_OFFSET_PX = 72

export function HomeTourSection({
  embedded = false,
  scrollToShowroom = false,
}: {
  embedded?: boolean
  /** Con ?unidad= hace scroll al título del showroom dentro de /inicio. */
  scrollToShowroom?: boolean
}) {
  const titleRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!scrollToShowroom) return
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    const scrollToTitle = () => {
      const node = titleRef.current
      if (!node) return
      const top = node.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET_PX
      window.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
    }

    // Varios intentos: fonts/hero/tour pueden mover el layout.
    scrollToTitle()
    const t1 = window.setTimeout(scrollToTitle, 50)
    const t2 = window.setTimeout(scrollToTitle, 300)
    const t3 = window.setTimeout(scrollToTitle, 800)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [scrollToShowroom])

  return (
    <section
      id="showroom"
      className={cn(
        'relative z-20 bg-[#f7f3ee]',
        scrollToShowroom
          ? 'pt-3 pb-16 sm:pt-4 sm:pb-20 lg:pb-28'
          : embedded
            ? 'py-16 sm:py-20 lg:py-28'
            : 'pt-24 pb-16 sm:pt-28 sm:pb-20 lg:pb-28',
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
          <p
            ref={titleRef}
            className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase"
          >
            Tour virtual
          </p>
          <h1 className="mt-3 text-[1.75rem] leading-tight font-bold sm:text-4xl">
            Recorre el showroom en 360°
          </h1>
          <p className="mt-4 text-[#2B1A18]/65">
            Entra a las unidades y cambia de ambiente. Si te interesa una tipología, te pedimos WhatsApp
            para enviarte planos y disponibilidad.
          </p>
        </div>
        <div className="relative mx-auto mt-8 h-[min(78dvh,580px)] min-h-[400px] w-full max-w-6xl overflow-hidden rounded-[16px] bg-[#111] shadow-[0_20px_50px_rgba(43,26,24,0.12)] ring-1 ring-[#2B1A18]/10 sm:mt-10 sm:h-[min(82dvh,720px)] sm:min-h-[480px] sm:rounded-[20px] sm:ring-[#BDA27E]/20 lg:h-[min(84dvh,760px)]">
          <TourSafeArea embedded />
          <div className="pointer-events-none absolute inset-0 z-30 rounded-[16px] ring-1 ring-inset ring-white/10 sm:rounded-[20px]" />
        </div>
      </div>
    </section>
  )
}
