'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const HEADER_OFFSET_PX = 72

export function HomeTourSection({
  embedded = false,
  scrollToShowroom = false,
  tourHref = '/tour',
}: {
  embedded?: boolean
  /** Con ?unidad= hace scroll al título del showroom dentro de /inicio. */
  scrollToShowroom?: boolean
  /** Entrada al showroom en pantalla completa. */
  tourHref?: string
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
            Entrá a las unidades, cambiá de ambiente y mirá los pisos en pantalla completa. Si te
            interesa una tipología, te pedimos WhatsApp para enviarte planos y disponibilidad.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <Link
              href={tourHref}
              className="inline-flex h-12 items-center rounded-lg bg-[#2B1A18] px-6 text-[11px] font-semibold tracking-[0.16em] text-white uppercase transition-colors hover:bg-[#3d2a24]"
            >
              Abrir showroom 360°
            </Link>
            <Link
              href="/contacto"
              className="inline-flex h-12 items-center rounded-lg px-5 text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase ring-1 ring-[#2B1A18]/20 transition-colors hover:bg-[#2B1A18]/5"
            >
              Agendar visita
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
