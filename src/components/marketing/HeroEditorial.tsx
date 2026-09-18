'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Building2, DoorOpen, ScanLine } from 'lucide-react'
import { notifyHeroLocked } from './heroLock'
import { LaviletLockup } from './LaviletLockup'

const PHOTO =
  'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/lavilet_333.png'

const FEATURES = [
  { label: 'Viviendas sobre el área comercial', Icon: Building2 },
  { label: 'Accesos independientes', Icon: DoorOpen },
  { label: 'Recorrido planta por planta', Icon: ScanLine },
] as const

export function HeroEditorial() {
  useEffect(() => {
    notifyHeroLocked()
  }, [])

  return (
    <section id="inicio" className="sticky top-0 z-0 h-svh overflow-hidden bg-[#e4e4de] lg:bg-[#1a1410] text-[#3f3d2e]">
      <div className="absolute top-0 inset-x-0 h-[48svh] sm:h-[55svh] lg:h-full">
        <Image
          src={PHOTO}
          alt="Fachada Lavilet al atardecer"
          fill
          priority
          className="object-cover object-[65%_center] lg:object-center"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#e4e4de] via-[#e4e4de]/20 to-transparent lg:hidden" />
      </div>

      <h1 className="sr-only">La Vilet</h1>

      <div className="relative z-10 mx-auto flex min-h-svh max-w-[1880px] flex-col px-5 pt-24 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 lg:px-12">
        <div className="flex flex-1 items-end lg:items-center">
          <div className="w-full max-w-[32rem] pb-2 lg:ml-4 lg:pb-0 xl:ml-8">
            <div className="mt-4">
              <LaviletLockup variant="story" />
            </div>
            <span aria-hidden className="mt-6 block h-px w-10 bg-[#3f3d2e]/45" />
            <p className="mt-6 max-w-sm text-[1.35rem] leading-snug text-[#2f2d22] [text-shadow:0_1px_14px_rgba(243,238,230,0.5)] sm:text-[1.6rem]">
              Vivienda, comercio y ciudad,
              <em className="block font-serif not-italic sm:italic">sin renunciar a tu privacidad.</em>
            </p>
            <ul className="mt-8 space-y-5">
              {FEATURES.map(({ label, Icon }) => (
                <li
                  key={label}
                  className="flex items-center gap-3.5 text-[19px] sm:text-[21px] tracking-[0.04em] text-[#2f2d22]/88 [text-shadow:0_1px_10px_rgba(243,238,230,0.45)]"
                >
                  <Icon size={24} strokeWidth={1.4} className="shrink-0 text-[#3f3d2e]" />
                  {label}
                </li>
              ))}
            </ul>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/tour"
                className="inline-flex h-12 items-center rounded-full bg-[#6d6c54] px-7 text-[11px] font-medium tracking-[0.18em] text-[#f3eee6] uppercase shadow-[0_10px_24px_rgba(47,45,34,0.22)] transition-colors hover:bg-[#5b5a45]"
              >
                Recorrer en 360°
                <ArrowRight size={14} className="ml-2" />
              </Link>
              <Link
                href="/contacto"
                className="inline-flex h-12 items-center rounded-full bg-[#e4e4de]/78 px-6 text-[11px] font-semibold tracking-[0.16em] text-[#3f3d2e] uppercase ring-1 ring-[#3f3d2e]/25 backdrop-blur-sm transition-colors hover:bg-[#e4e4de]"
              >
                Agendar visita
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-auto flex justify-end pt-4 text-[10px] tracking-[0.22em] text-[#f3eee6]/80 uppercase [text-shadow:0_1px_10px_rgba(20,14,10,0.45)]">
          <p>Puertas del Sol — Cuenca</p>
        </div>
      </div>
    </section>
  )
}
