'use client'

import { TourSafeArea } from '@/components/tour/TourSafeArea'

export function HomeTourSection() {
  return (
    <section id="tour" className="relative z-20 scroll-mt-24 bg-[#f7f3ee] py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Tour virtual</p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Recorre el showroom en 360°</h2>
          <p className="mt-4 text-[#2B1A18]/65">
            Entra a las unidades y cambia de ambiente. Si te interesa una tipología, te pedimos WhatsApp
            para enviarte planos y disponibilidad.
          </p>
        </div>
        <div className="-mx-4 mt-10 h-[min(82dvh,720px)] min-h-[480px] overflow-hidden bg-black shadow-sm ring-1 ring-[#2B1A18]/8 sm:mx-0 sm:rounded-2xl">
          <TourSafeArea embedded />
        </div>
      </div>
    </section>
  )
}
