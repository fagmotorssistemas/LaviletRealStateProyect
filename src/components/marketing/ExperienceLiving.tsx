'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Home, Leaf, Waves } from 'lucide-react'
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from 'framer-motion'
import { cn } from '@/lib/utils'

const AMENITIES = [
  {
    id: 'parques',
    kicker: 'Entorno',
    label: 'El río cercano',
    image: '/CUENCA4.png',
    detail: 'El Tomebamba y el parque lineal como parte del recorrido cotidiano.',
  },
  {
    id: 'comunales',
    kicker: 'Hogar',
    label: 'Espacios que conectan',
    image: '/lavilet-sala.jpg',
    detail: 'Espacios para encontrarse: estar, jardines y la terraza en un mismo ritmo.',
  },
  {
    id: 'terrazas',
    kicker: 'Altura',
    label: 'Terraza sobre la ciudad',
    image:
      'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/lavilet_terraza.png',
    detail: 'Un espacio propio del proyecto para detenerse y mirar Cuenca.',
  },
] as const

const PILLARS = [
  { icon: Leaf, label: 'Naturaleza cercana' },
  { icon: Home, label: 'Diseño con propósito' },
  { icon: Waves, label: 'Calidad de vida' },
] as const

function ExperiencePoster({
  item,
  instant = false,
  compact = false,
}: {
  item: (typeof AMENITIES)[number]
  instant?: boolean
  compact?: boolean
}) {
  return (
    <motion.article
      key={item.id}
      className="absolute inset-0 flex flex-col overflow-hidden rounded-[1.5rem] bg-[#f7f2eb] shadow-[0_22px_48px_rgba(30,28,18,0.22)]"
      initial={
        instant
          ? false
          : compact
            ? { opacity: 0, y: 36 }
            : { opacity: 1, y: '80vh' }
      }
      animate={{ opacity: 1, y: 0 }}
      exit={compact ? { opacity: 0, y: -36 } : { opacity: 1, y: '-80vh' }}
      transition={{
        duration: instant ? 0 : compact ? 0.55 : 1.85,
        ease: compact ? [0.22, 1, 0.36, 1] : [0.45, 0.05, 0.2, 1],
      }}
    >
      <div className="relative h-[50%] w-full shrink-0">
        <Image
          src={item.image}
          alt={item.label}
          fill
          className="object-cover"
          sizes="360px"
        />
      </div>
      <div className="flex flex-1 flex-col px-5 pt-4 pb-4 sm:px-6 sm:pt-5 sm:pb-5" style={{ color: '#2B1A18' }}>
        <p className="flex items-center gap-3 text-[10px] font-medium tracking-[0.22em] uppercase opacity-50">
          {item.kicker}
          <span className="h-px w-7 bg-[#2B1A18] opacity-35" />
        </p>
        <h3 className="mt-2 font-serif text-[1.5rem] leading-[1.08] tracking-[-0.03em] sm:text-[1.75rem]">
          {item.label}
        </h3>
        <p className="mt-2 text-[13.5px] leading-relaxed opacity-70 sm:text-[14.5px]">
          {item.detail}
        </p>
        <Link
          href="/proyectos"
          className="mt-auto inline-flex items-center pt-3 text-[10px] font-medium tracking-[0.2em] uppercase opacity-65 transition-opacity hover:opacity-100"
        >
          Descubrir más
          <ArrowRight size={12} className="ml-2" />
        </Link>
      </div>
    </motion.article>
  )
}

function ExperienceStage({
  left,
  right,
  active,
  reduce,
  mobile,
}: {
  left: (typeof AMENITIES)[number]
  right: (typeof AMENITIES)[number]
  active: number
  reduce: boolean | null
  mobile: boolean
}) {
  if (mobile) {
    return (
      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-lg flex-col px-5 py-8">
        <div className="relative z-20">
          <h2
            id="experiencia-title"
            className="font-serif text-[clamp(2.8rem,15vw,4.6rem)] leading-[0.86] font-normal tracking-[-0.04em] text-[#72735A]"
          >
            Experiencia
          </h2>
          <p className="mt-3 font-serif text-[1.25rem] leading-none text-[#72735A]/90">
            Vivir en La Vilet.
          </p>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[#2B1A18]/70">
            Última planta alta. Un lugar para desconectarse y encontrarse.
          </p>
        </div>

        <div className="relative mx-auto mt-8 aspect-[4/5] w-full max-w-[22rem]">
          {reduce ? (
            <ExperiencePoster item={left} instant compact />
          ) : (
            <AnimatePresence mode="wait">
              <ExperiencePoster key={left.id} item={left} compact />
            </AnimatePresence>
          )}
        </div>

        <div className="mt-7 flex justify-center gap-2">
          {AMENITIES.map((amenity, index) => (
            <span
              key={amenity.id}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                index === active ? 'w-8 bg-[#72735A]' : 'w-1.5 bg-[#72735A]/25',
              )}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="relative z-10 mx-auto min-h-svh w-full max-w-[1680px] px-5 py-6 sm:px-10 lg:px-14 lg:py-8">
      <div className="relative flex min-h-[calc(100svh-3rem)] flex-col lg:min-h-[calc(100svh-4rem)]">
        <div className="flex flex-col lg:grid flex-1 items-start gap-8 lg:gap-10 pb-8 lg:pb-16 lg:grid-cols-[minmax(16rem,0.95fr)_auto_minmax(15rem,0.85fr)] lg:gap-x-6 lg:pt-[5vh] xl:gap-x-10">
          <div className="relative z-20 w-full max-w-[32rem]">
            <h2
              id="experiencia-title"
              className="mt-2 lg:mt-4 font-serif text-[clamp(2.8rem,6.4vw,6.15rem)] leading-[0.86] font-normal tracking-[-0.04em] text-[#72735A]"
            >
              Experiencia
            </h2>
            <p className="mt-2 lg:mt-6 font-serif text-[1.2rem] lg:text-[1.55rem] leading-none text-[#72735A]/90 sm:text-[1.8rem]">
              Vivir en La Vilet.
            </p>
            <span className="mt-4 lg:mt-8 block h-px w-10 bg-[#72735A]/30" />

            <p className="mt-6 lg:mt-16 max-w-[15.5rem] text-[15px] lg:text-[16px] leading-snug text-[#2B1A18]/70 sm:text-[17px]">
              Última planta alta. Un lugar para desconectarse y encontrarse.
            </p>
            <Link
              href="/proyectos"
              className="mt-6 lg:mt-12 inline-flex items-center gap-2 rounded-full border border-[#72735A]/30 px-5 py-2 lg:px-6 lg:py-2.5 text-[13px] lg:text-[14px] text-[#72735A] transition-colors hover:border-[#72735A] hover:bg-[#72735A]/5"
            >
              Conocer más
              <ArrowRight size={15} />
            </Link>
          </div>

          <div className="relative z-10 mx-auto mt-4 lg:mt-48 h-[34rem] sm:h-[38rem] w-full max-w-[24rem] sm:max-w-[40rem] lg:h-[42rem] lg:w-[50rem] lg:max-w-none">
            <div className="absolute top-0 left-0 z-10 w-[14rem] sm:w-[16rem] lg:w-[21rem]">
              <div className="relative aspect-[4/5]">
                {reduce ? (
                  <ExperiencePoster item={left} instant />
                ) : (
                  <AnimatePresence mode="sync">
                    <ExperiencePoster key={`l-${left.id}`} item={left} />
                  </AnimatePresence>
                )}
              </div>
            </div>

            <div className="absolute top-[13.5rem] left-[4.5rem] sm:top-[15rem] sm:left-[8rem] z-20 w-[14rem] sm:w-[16rem] lg:top-[16rem] lg:left-[24rem] lg:w-[21rem]">
              <div className="relative aspect-[4/5]">
                {reduce ? (
                  <ExperiencePoster item={right} instant />
                ) : (
                  <AnimatePresence mode="sync">
                    <ExperiencePoster key={`r-${right.id}`} item={right} />
                  </AnimatePresence>
                )}
              </div>
            </div>
          </div>

          <div className="hidden lg:block max-w-[18rem] lg:mt-[18rem] lg:justify-self-end">
            <p className="max-w-[15.5rem] border-l border-[#72735A]/30 pl-5 text-[16px] leading-snug text-[#2B1A18]/70">
              Espacios pensados para un equilibrio entre lo urbano y lo natural.
            </p>
            <ul className="mt-14 space-y-7">
              {PILLARS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-4 text-[#72735A]">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#72735A]/30">
                    <Icon size={22} strokeWidth={1.25} />
                  </span>
                  <span className="text-[15px] leading-tight">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="relative mt-10 flex items-end justify-between gap-4 lg:absolute lg:inset-x-0 lg:bottom-5 lg:mt-0">
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
            <div className="mt-3 flex justify-center gap-2">
              {AMENITIES.map((amenity, index) => (
                <span
                  key={amenity.id}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-300',
                    index === active ? 'w-8 bg-[#72735A]' : 'w-1.5 bg-[#72735A]/25',
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ExperienceLiving() {
  const reduce = useReducedMotion()
  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [mobile, setMobile] = useState(true)
  const left = AMENITIES[active] ?? AMENITIES[0]
  const right = AMENITIES[(active + 1) % AMENITIES.length] ?? AMENITIES[0]
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start 80px', 'end end'],
  })

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const sync = () => setMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const next = Math.min(
      AMENITIES.length - 1,
      Math.max(0, Math.floor(value * AMENITIES.length)),
    )
    setActive((current) => (current === next ? current : next))
  })

  return (
    <section
      className="relative z-20 text-[#72735A] mkt-dark:text-[#F2F2F2]"
      aria-labelledby="experiencia-title"
    >
      <div
        ref={trackRef}
        className="relative"
        style={{ height: reduce ? 'auto' : `calc(100svh + ${AMENITIES.length * 28}svh)` }}
      >
        <div className={cn('relative overflow-hidden', reduce ? 'min-h-svh' : 'sticky top-0 min-h-svh')}>
          <div aria-hidden className="absolute inset-0 bg-[#f4f1ea]" />
          
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 z-[1] h-[50%] w-full lg:top-[-2%] lg:left-1/2 lg:h-[52%] lg:w-[min(38vw,22rem)] lg:-translate-x-1/2 overflow-hidden lg:rounded-[1.4rem] opacity-15 lg:opacity-30"
          >
            <Image
              src="/lavilet-exterior.jpg"
              alt=""
              fill
              className="object-cover object-center"
              sizes="(max-width: 1024px) 100vw, 22rem"
            />
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 z-[1] h-[50%] w-full lg:bottom-[-4%] lg:left-1/2 lg:h-[50%] lg:w-[min(36vw,20rem)] lg:-translate-x-1/2 overflow-hidden lg:rounded-[1.4rem] opacity-10 lg:opacity-20"
          >
            <Image
              src="/lavilet-comedor.jpg"
              alt=""
              fill
              className="object-cover object-center"
              sizes="(max-width: 1024px) 100vw, 18rem"
            />
          </div>

          <ExperienceStage
            left={left}
            right={right}
            active={active}
            reduce={reduce}
            mobile={mobile}
          />
        </div>
      </div>

    </section>
  )
}
