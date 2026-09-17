'use client'

import { useRef, useState } from 'react'
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
    label: 'Verde cercano',
    image:
      'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1400&q=80',
    detail: 'El Tomebamba como extensión natural del hogar.',
  },
  {
    id: 'comunales',
    kicker: 'Hogar',
    label: 'Espacios que conectan',
    image: '/lavilet-sala.jpg',
    detail: 'Espacios para encontrarse: estar, jardines y la terraza en un mismo ritmo.',
  },
  {
    id: 'piscina',
    kicker: 'Bienestar',
    label: 'Agua y calma',
    image:
      'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=1400&q=80',
    detail: 'Un espacio de relajación para desconectar del día a día.',
  },
  {
    id: 'residencial',
    kicker: 'Vivienda',
    label: 'Zona residencial',
    image:
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1400&q=80',
    detail: 'Accesos independientes y calma, sobre el comercio.',
  },
  {
    id: 'gimnasio',
    kicker: 'Rutina',
    label: 'Gimnasio',
    image:
      'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1400&q=80',
    detail: 'Equipamiento de primer nivel para el día a día.',
  },
  {
    id: 'terrazas',
    kicker: 'Altura',
    label: 'Terrazas',
    image:
      'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1400&q=80',
    detail: 'Vistas a la ciudad, para el día y para el atardecer.',
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
}: {
  item: (typeof AMENITIES)[number]
  instant?: boolean
}) {
  return (
    <motion.article
      key={item.id}
      className="absolute inset-0 flex flex-col overflow-hidden rounded-[1.5rem] bg-[#f7f2eb] shadow-[0_22px_48px_rgba(30,28,18,0.22)]"
      initial={instant ? false : { opacity: 1, y: '80vh' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 1, y: '-80vh' }}
      transition={{ duration: instant ? 0 : 1.85, ease: [0.45, 0.05, 0.2, 1] }}
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
}: {
  left: (typeof AMENITIES)[number]
  right: (typeof AMENITIES)[number]
  active: number
  reduce: boolean | null
}) {
  return (
    <div className="relative z-10 mx-auto min-h-svh w-full max-w-[1680px] px-5 py-6 sm:px-10 lg:px-14 lg:py-8">
      <div className="relative flex min-h-[calc(100svh-3rem)] flex-col lg:min-h-[calc(100svh-4rem)]">
        <div className="flex flex-col lg:grid flex-1 items-start gap-8 lg:gap-10 pb-8 lg:pb-16 lg:grid-cols-[minmax(16rem,0.95fr)_auto_minmax(15rem,0.85fr)] lg:gap-x-6 lg:pt-[5vh] xl:gap-x-10">
          <div className="relative z-20 w-full max-w-[32rem]">
            <h2
              id="experiencia-title"
              className="mt-2 lg:mt-4 font-serif text-[clamp(2.8rem,6.4vw,6.15rem)] leading-[0.86] font-normal tracking-[-0.04em] text-[#f4efe8]"
            >
              Experiencia
            </h2>
            <p className="mt-2 lg:mt-6 font-serif text-[1.2rem] lg:text-[1.55rem] leading-none text-[#f4efe8]/90 sm:text-[1.8rem]">
              Vivir en La Vilet.
            </p>
            <span className="mt-4 lg:mt-8 block h-px w-10 bg-[#f4efe8]/55" />

            <p className="mt-6 lg:mt-16 max-w-[15.5rem] text-[15px] lg:text-[16px] leading-snug text-[#f4efe8]/88 sm:text-[17px]">
              Última planta alta. Un lugar para desconectarse y encontrarse.
            </p>
            <Link
              href="/proyectos"
              className="mt-6 lg:mt-12 inline-flex items-center gap-2 rounded-full border border-[#f4efe8]/55 px-5 py-2 lg:px-6 lg:py-2.5 text-[13px] lg:text-[14px] text-[#f4efe8] transition-colors hover:border-[#f4efe8] hover:bg-[#f4efe8]/10"
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
            <p className="max-w-[15.5rem] border-l border-[#f4efe8]/30 pl-5 text-[16px] leading-snug text-[#f4efe8]/88">
              Espacios pensados para un equilibrio entre lo urbano y lo natural.
            </p>
            <ul className="mt-14 space-y-7">
              {PILLARS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-4 text-[#f4efe8]/90">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#f4efe8]/30">
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
                    index === active ? 'w-8 bg-[#f4efe8]' : 'w-1.5 bg-[#f4efe8]/35',
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
  const loop = [...AMENITIES, ...AMENITIES, ...AMENITIES]
  const left = AMENITIES[active] ?? AMENITIES[0]
  const right = AMENITIES[(active + 1) % AMENITIES.length] ?? AMENITIES[0]
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start 80px', 'end end'] as any,
  })

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
        style={{ height: reduce ? 'auto' : `${AMENITIES.length * 50}svh` }}
      >
        <div className={cn('relative overflow-hidden', reduce ? 'min-h-svh' : 'sticky top-0 min-h-svh')}>
          <div aria-hidden className="absolute inset-0 bg-[#6d6f57]" />
          <div
            aria-hidden
            className="absolute inset-0 opacity-40 mix-blend-multiply"
            style={{
              backgroundImage: `
                radial-gradient(ellipse 38% 32% at 12% 18%, rgba(30,32,18,0.55), transparent 70%),
                radial-gradient(ellipse 48% 40% at 88% 8%, rgba(24,26,14,0.4), transparent 72%),
                radial-gradient(ellipse 30% 28% at 70% 80%, rgba(20,22,12,0.35), transparent 70%),
                radial-gradient(ellipse 22% 18% at 30% 72%, rgba(20,22,12,0.28), transparent 70%)
              `,
            }}
          />

          <svg
            aria-hidden
            viewBox="0 0 180 420"
            className="pointer-events-none absolute top-[-6%] left-[-2%] z-[1] h-[78%] w-[min(28vw,18rem)] text-[#4f523d]/55"
          >
            <g fill="currentColor">
              <ellipse cx="38" cy="70" rx="18" ry="42" transform="rotate(-28 38 70)" />
              <ellipse cx="68" cy="110" rx="16" ry="40" transform="rotate(18 68 110)" />
              <ellipse cx="42" cy="160" rx="20" ry="46" transform="rotate(-12 42 160)" />
              <ellipse cx="78" cy="210" rx="17" ry="44" transform="rotate(24 78 210)" />
              <ellipse cx="36" cy="250" rx="19" ry="48" transform="rotate(-22 36 250)" />
              <ellipse cx="64" cy="310" rx="15" ry="38" transform="rotate(14 64 310)" />
            </g>
          </svg>

          <div
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 z-[1] h-[50%] w-full lg:top-[-2%] lg:left-1/2 lg:h-[52%] lg:w-[min(38vw,22rem)] lg:-translate-x-1/2 overflow-hidden lg:rounded-[1.4rem] opacity-30 lg:opacity-65"
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
            className="pointer-events-none absolute bottom-0 left-0 z-[1] h-[50%] w-full lg:bottom-[-4%] lg:left-1/2 lg:h-[50%] lg:w-[min(36vw,20rem)] lg:-translate-x-1/2 overflow-hidden lg:rounded-[1.4rem] opacity-20 lg:opacity-55"
          >
            <Image
              src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1400&q=80"
              alt=""
              fill
              className="object-cover object-center"
              sizes="(max-width: 1024px) 100vw, 18rem"
            />
          </div>

          <ExperienceStage left={left} right={right} active={active} reduce={reduce} />
        </div>
      </div>

      <div className="overflow-hidden border-y border-[#72735A]/12 py-4 mkt-dark:border-white/10">
        <motion.div
          className="flex w-max gap-10 whitespace-nowrap"
          animate={reduce ? undefined : { x: ['0%', '-33.333%'] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
        >
          {loop.map((amenity, index) => (
            <span
              key={`${amenity.id}-${index}`}
              className="font-serif text-2xl tracking-[-0.03em] text-[#72735A]/28 sm:text-3xl mkt-dark:text-[#F2F2F2]/35"
            >
              {amenity.label}
              <span className="mx-4 text-[#BDA27E]/50">·</span>
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
