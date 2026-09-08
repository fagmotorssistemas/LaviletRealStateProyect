'use client'

import { TourSafeArea } from '@/components/tour/TourSafeArea'

export function HomeTourSection() {
  return (
    <section id="tour" className="relative z-20 scroll-mt-20 bg-[#f7f3ee] py-10 sm:scroll-mt-24 sm:py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
          <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Tour virtual</p>
          <h2 className="mt-3 text-[1.75rem] leading-tight font-bold sm:text-4xl">Recorre el showroom en 360°</h2>
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
