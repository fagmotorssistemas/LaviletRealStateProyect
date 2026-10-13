'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Building2, DoorOpen, ScanLine } from 'lucide-react'
import { CmafVideo } from '@/components/media/CmafVideo'
import { notifyHeroLocked } from './heroLock'
import { LaviletLockup } from './LaviletLockup'
import { heroAntonio } from './heroFont'

const FEATURES = [
  { label: 'Viviendas sobre el área comercial', Icon: Building2 },
  { label: 'Accesos independientes', Icon: DoorOpen },
  { label: 'Recorrido planta por planta', Icon: ScanLine },
] as const

export function HeroEditorial() {
  const [coverSrc, setCoverSrc] = useState<string | null>(null)
  useLayoutEffect(() => {
    setCoverSrc(
      window.matchMedia('(pointer: coarse)').matches
        ? '/inicio/portada-v2/portada-v2-mobile.mp4'
        : '/inicio/portada-v2/portada-v2.mp4',
    )
  }, [])
  useEffect(() => {
    notifyHeroLocked()
  }, [])

  return (
    <section id="inicio" className={`${heroAntonio.className} sticky top-0 z-0 h-svh overflow-hidden bg-[#F5F3EB] text-[#484C3B]`}>
      <div className="absolute top-0 inset-x-0 h-[48svh] sm:h-[55svh] lg:h-full">
        {coverSrc ? (
          <CmafVideo
            mp4={coverSrc}
            preload="auto"
            label="Fachada Lavilet del día a la noche"
            className="absolute inset-0 h-full w-full object-cover object-[65%_center] lg:object-center"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[#F5F3EB] via-[#F5F3EB]/25 to-transparent lg:hidden" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-[#F5F3EB]/90 via-[#F5F3EB]/45 to-transparent lg:block" />
      </div>

      <h1 className="sr-only">La Vilet</h1>

      <div className="relative z-10 mx-auto flex min-h-svh max-w-[1880px] flex-col px-5 pt-24 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 lg:px-12">
        <div className="flex flex-1 items-end lg:items-center">
          <div className="w-full max-w-[32rem] pb-2 lg:ml-4 lg:pb-0 xl:ml-8">
            <div className="mt-4">
              <LaviletLockup variant="story" heroPalette />
            </div>
            <span aria-hidden className="mt-6 block h-px w-10 bg-[#A77855]" />
            <p className="mt-6 max-w-sm text-[clamp(1.1rem,2vw,1.3rem)] font-light leading-snug tracking-[0.04em] text-[#484C3B] [text-shadow:0_1px_14px_rgba(245,243,235,0.7)]">
              Vivienda, comercio y ciudad,
              <em className="block not-italic">sin renunciar a tu privacidad.</em>
            </p>
            <ul className="mt-8 space-y-5">
              {FEATURES.map(({ label, Icon }) => (
                <li
                  key={label}
                  className="flex items-center gap-3.5 text-[17px] font-light tracking-[0.04em] text-[#484C3B] [text-shadow:0_1px_10px_rgba(245,243,235,0.7)] sm:text-[19px]"
                >
                  <Icon size={24} strokeWidth={1.4} className="shrink-0 text-[#686C55]" />
                  {label}
                </li>
              ))}
            </ul>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/tour"
                className="inline-flex h-12 items-center rounded-full bg-[#484C3B] px-7 text-[13px] font-normal tracking-[0.32em] text-[#F5F3EB] uppercase shadow-[0_10px_24px_rgba(48,49,44,0.22)] transition-colors hover:bg-[#30312C]"
              >
                Recorrer en 360°
                <ArrowRight size={14} className="ml-2" />
              </Link>
              <Link
                href="/contacto"
                className="inline-flex h-12 items-center rounded-full bg-[#F5F3EB]/85 px-6 text-[13px] font-normal tracking-[0.32em] text-[#484C3B] uppercase ring-1 ring-[#484C3B]/30 backdrop-blur-sm transition-colors hover:bg-[#F5F3EB]"
              >
                Agendar visita
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-auto flex justify-end pt-4 text-[13px] font-light tracking-[0.32em] text-[#F5F3EB] uppercase [text-shadow:0_1px_10px_rgba(48,49,44,0.8)]">
          <p>Puertas del Sol — Cuenca</p>
        </div>
      </div>
    </section>
  )
}
