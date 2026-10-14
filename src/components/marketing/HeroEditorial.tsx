'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Building2, DoorOpen, ScanLine } from 'lucide-react'
import { CmafVideo } from '@/components/media/CmafVideo'
import { notifyHeroLocked } from './heroLock'
import { LaviletLockup } from './LaviletLockup'

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
    <section id="inicio" className="sticky top-0 z-0 h-svh overflow-hidden bg-lv-bg text-lv-ink">
      <div className="absolute top-0 inset-x-0 h-[48svh] sm:h-[55svh] lg:h-full">
        {coverSrc ? (
          <CmafVideo
            mp4={coverSrc}
            preload="auto"
            label="Fachada Lavilet del día a la noche"
            className="absolute inset-0 h-full w-full object-cover object-[65%_center] lg:object-center"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-lv-bg via-lv-bg/25 to-transparent lg:hidden" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-lv-bg/90 via-lv-bg/45 to-transparent lg:block" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-lv-bg/90 to-transparent" />
      </div>

      <h1 className="sr-only">La Vilet</h1>

      <div className="relative z-10 mx-auto flex min-h-svh max-w-[1880px] flex-col px-5 pt-24 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 lg:px-12">
        <div className="flex flex-1 items-end lg:items-center">
          <div className="w-full max-w-[32rem] pb-2 lg:ml-4 lg:pb-0 xl:ml-8">
            <div className="mt-4">
              <LaviletLockup variant="story" heroPalette />
            </div>
            <span aria-hidden className="lv-bronze-line mt-6 block h-px w-10" />
            <p className="mt-6 max-w-sm text-[clamp(1.2rem,2.2vw,1.45rem)] font-extralight leading-[1.7] tracking-[0.04em] text-lv-ink">
              Vivienda, comercio y ciudad,
              <em className="block not-italic">sin renunciar a tu privacidad.</em>
            </p>
            <ul className="mt-8 space-y-5">
              {FEATURES.map(({ label, Icon }) => (
                <li
                  key={label}
                  className="flex items-center gap-3.5 text-[18px] font-light tracking-[0.04em] text-lv-ink sm:text-[21px]"
                >
                  <Icon size={24} strokeWidth={1.4} className="shrink-0 text-lv-ink-soft" />
                  {label}
                </li>
              ))}
            </ul>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/tour"
                className="lv-primary inline-flex h-12 items-center px-7 text-[12px] font-normal tracking-[0.18em] uppercase"
              >
                Recorrer en 360°
                <ArrowRight size={14} className="ml-2" />
              </Link>
              <Link
                href="/contacto"
                className="lv-secondary inline-flex h-12 items-center px-6 text-[12px] font-normal tracking-[0.18em] uppercase"
              >
                Agendar visita
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-auto flex justify-end pt-4 text-[13px] font-normal tracking-[0.22em] text-lv-ink uppercase">
          <p>Puertas del Sol — Cuenca</p>
        </div>
      </div>
    </section>
  )
}
