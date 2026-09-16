'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

const BASE =
  'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet'

const SPACES = [
  {
    id: 'cocina',
    title: 'La cocina',
    body: 'Isla, madera y la luz de la tarde. El oficio diario, bien resuelto.',
    src: `${BASE}/cocina_lavilet.png`,
    alt: 'Cocina de La Vilēt, con isla y madera',
  },
  {
    id: 'comedor',
    title: 'El comedor',
    body: 'Una mesa para quedarse. Estantería, paisaje y silencio.',
    src: `${BASE}/comedor_lavilet.png`,
    alt: 'Comedor de La Vilēt',
  },
  {
    id: 'dormitorio',
    title: 'El dormitorio',
    body: 'Calma, madera y una cama que no pide prisa.',
    src: `${BASE}/dormitorio_lavilet.png`,
    alt: 'Dormitorio de La Vilēt',
  },
  {
    id: 'lavanderia',
    title: 'La lavandería',
    body: 'Un cuarto de servicio pensado, no escondido.',
    src: `${BASE}/lavanderia_lavilet.png`,
    alt: 'Lavandería de La Vilēt',
  },
  {
    id: 'estar',
    title: 'Estar y comer',
    body: 'Un solo espacio abierto. La ciudad, al fondo.',
    src: `${BASE}/lavilet_comedor.png`,
    alt: 'Estar-comedor de La Vilēt',
  },
  {
    id: 'sala',
    title: 'La sala',
    body: 'Para recibir, sin teatralidad.',
    src: `${BASE}/lavilet_sala.png`,
    alt: 'Sala de La Vilēt',
  },
] as const

const ease = 'cubic-bezier(0.22, 1, 0.36, 1)'

export function EspaciosAccordion() {
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const total = SPACES.length
  const current = SPACES[active]

  const go = (index: number) => {
    setActive((index + total) % total)
    setHover(null)
  }

  return (
    <section
      className="relative z-20 bg-[#EDECE6] pb-16 text-[#F2F2F2] mkt-dark:bg-[#1f201a] sm:pb-24"
      aria-labelledby="espacios-title"
    >
      <div className="mx-auto max-w-[1400px] px-5 pb-8 sm:px-8">
        <p className="text-[11px] font-medium tracking-[0.34em] text-[#8B8C74] uppercase">
          por dentro
        </p>
        <h2
          id="espacios-title"
          className="mt-3 font-serif text-[clamp(2.4rem,6vw,4.6rem)] leading-[0.86] font-normal tracking-[-0.045em] text-[#72735A] mkt-dark:text-[#F2F2F2]"
        >
          los espacios
        </h2>
      </div>

      <div className="relative h-[min(88vh,920px)] w-full overflow-hidden">
        <div className="flex h-full w-full">
          {SPACES.map((space, index) => {
            const isActive = index === active
            const isHover = hover === index && !isActive
            const grow = isActive ? 8.2 : isHover && !reduce ? 2.6 : 1.15
            const n = String(index + 1).padStart(2, '0')

            return (
              <button
                key={space.id}
                type="button"
                aria-pressed={isActive}
                aria-label={`${space.title}. ${space.body}`}
                className="relative min-w-[5.25rem] overflow-hidden text-left sm:min-w-[6.75rem]"
                style={{
                  flexGrow: grow,
                  flexShrink: 1,
                  flexBasis: 0,
                  transition: reduce ? 'none' : `flex-grow 0.65s ${ease}`,
                }}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                onClick={() => go(index)}
              >
                <Image
                  src={space.src}
                  alt={space.alt}
                  fill
                  sizes={isActive ? '70vw' : '18vw'}
                  className={cn(
                    'object-cover transition-transform duration-700',
                    isActive ? 'scale-100' : 'scale-105',
                  )}
                  priority={index === 0}
                />
                <div
                  className={cn(
                    'absolute inset-0 transition-colors duration-500',
                    isActive ? 'bg-black/20' : 'bg-black/45',
                  )}
                />

                <div
                  className={cn(
                    'absolute inset-0 flex flex-col p-4 sm:p-6',
                    isActive ? 'justify-end' : 'items-center justify-between py-5',
                  )}
                >
                  <span className="text-[11px] font-medium tracking-[0.28em]">
                    {n}
                  </span>

                  {isActive ? (
                    <div className="max-w-xl pr-8">
                      <p className="font-serif text-[clamp(1.8rem,4vw,3.1rem)] leading-[0.9] tracking-[-0.04em]">
                        {space.title}
                      </p>
                      <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#F2F2F2]/85 sm:text-[15px]">
                        {space.body}
                      </p>
                    </div>
                  ) : (
                    <>
                      <span className="[writing-mode:vertical-rl] rotate-180 font-serif text-[11px] tracking-[0.22em] uppercase sm:text-xs">
                        {space.title}
                      </span>
                      <span className="text-lg leading-none" aria-hidden>
                        +
                      </span>
                    </>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <div className="pointer-events-none absolute right-4 bottom-4 z-10 flex items-center gap-3 sm:right-6 sm:bottom-6">
          <p className="pointer-events-none font-serif text-sm tracking-[0.12em] text-[#F2F2F2]/90">
            {String(active + 1).padStart(2, '0')}
            <span className="mx-1.5 text-[#F2F2F2]/45">/</span>
            {String(total).padStart(2, '0')}
          </p>
          <div className="pointer-events-auto flex gap-1">
            <button
              type="button"
              aria-label="Espacio anterior"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F2F2F2]/90 text-[#72735A] transition-colors hover:bg-[#F2F2F2]"
              onClick={() => go(active - 1)}
            >
              <ArrowLeft size={16} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label="Espacio siguiente"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F2F2F2]/90 text-[#72735A] transition-colors hover:bg-[#F2F2F2]"
              onClick={() => go(active + 1)}
            >
              <ArrowRight size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      <p className="sr-only">{current.title}. {current.body}</p>
    </section>
  )
}
