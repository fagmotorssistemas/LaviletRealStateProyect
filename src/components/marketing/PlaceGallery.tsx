'use client'

import { useLayoutEffect, useRef, useState, type Ref } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'
import { NEARBY_PLACES } from '@/lib/marketing/nearbyPlaces'
import { AboutTitleMark } from './FooterWordmark'

const TERRAZA =
  'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/lavilet_terraza.png'

const STATS = [
  { value: '1', label: 'sector', note: 'Puertas del Sol' },
  { value: '2', label: 'vidas', note: 'vivir y emprender' },
  { value: '1', label: 'río', note: 'Tomebamba' },
] as const

const PLACE_CARDS = NEARBY_PLACES.slice(0, 3)

type PhotoSlide = {
  kind: 'photo'
  src: string
  alt: string
  kicker: string
  title: string
  credit: string
  width: string
  object?: string
  last?: boolean
}

const PHOTOS: PhotoSlide[] = [
  {
    kind: 'photo',
    src: '/CUENCA2.png',
    alt: 'Cuenca desde las alturas',
    kicker: 'Nosotros',
    title: 'Un lugar donde el tiempo se detiene',
    credit: 'Cuenca · Ecuador',
    width: 'w-[88vw] sm:w-[82vw] lg:w-[76vw]',
    object: 'object-cover object-center',
  },
  {
    kind: 'photo',
    src: '/CUENCA4.png',
    alt: 'El río Tomebamba en Cuenca',
    kicker: 'El río',
    title: 'El Tomebamba, a unos pasos',
    credit: 'Agua, luz y verde',
    width: 'w-[78vw] sm:w-[70vw] lg:w-[64vw]',
    object: 'object-cover object-[center_60%]',
  },
  {
    kind: 'photo',
    src: '/CUENCA3.jpg',
    alt: 'El centro histórico de Cuenca',
    kicker: 'La ciudad',
    title: 'La ciudad, de vuelta',
    credit: 'Centro histórico',
    width: 'w-[80vw] sm:w-[72vw] lg:w-[66vw]',
  },
  {
    kind: 'photo',
    src: '/lavilet-exterior.jpg',
    alt: 'Fachada de La Vilet',
    kicker: 'La Vilet',
    title: 'Puertas del Sol',
    credit: 'Suites & Apartments',
    width: 'w-[78vw] sm:w-[68vw] lg:w-[62vw]',
    object: 'object-cover object-[center_40%]',
  },
  {
    kind: 'photo',
    src: TERRAZA,
    alt: 'Terraza rooftop de La Vilet',
    kicker: 'Arriba',
    title: 'La terraza, sobre la ciudad',
    credit: 'El día se queda aquí',
    width: 'w-[82vw] sm:w-[74vw] lg:w-[68vw]',
    last: true,
  },
]

function PaperGrain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-50 mix-blend-multiply"
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(114,115,90,0.04) 0px, rgba(114,115,90,0.04) 1px, transparent 1px, transparent 3px), repeating-linear-gradient(90deg, rgba(114,115,90,0.03) 0px, rgba(114,115,90,0.03) 1px, transparent 1px, transparent 4px)',
      }}
    />
  )
}

function PhotoPanel({
  slide,
  onRelease,
}: {
  slide: PhotoSlide
  onRelease?: () => void
}) {
  return (
    <article className={cn('relative h-full shrink-0', slide.width)}>
      <Image
        src={slide.src}
        alt={slide.alt}
        fill
        sizes="90vw"
        className={cn('object-cover', slide.object)}
        priority={slide.kicker === 'Nosotros'}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 sm:p-8 lg:p-10">
        <div className="max-w-md text-white">
          <p className="text-[11px] font-medium tracking-[0.32em] uppercase">{slide.kicker}</p>
          <h3 className="mt-2 font-serif text-[clamp(1.7rem,4vw,3.1rem)] leading-[0.95] font-normal tracking-[-0.03em]">
            {slide.title}
          </h3>
          <p className="mt-2 text-xs tracking-[0.16em] text-white/70 uppercase">{slide.credit}</p>
        </div>
        {slide.last ? (
          <button
            type="button"
            onClick={onRelease}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-sm bg-[#BDA27E] text-[#2B1A18] transition-transform hover:scale-105"
            aria-label="Seguir bajando"
          >
            <ArrowDown size={18} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </article>
  )
}

function AboutPanel({ full = false }: { full?: boolean }) {
  return (
    <article
      className={cn(
        'relative flex h-full shrink-0 flex-col justify-center overflow-hidden bg-[#f4f1ea] px-7 py-12 sm:px-12 lg:px-16',
        full ? 'min-h-[32rem] w-full' : 'w-[min(100vw,42rem)] sm:w-[56vw] lg:w-[48vw]',
      )}
    >
      <PaperGrain />
      <div className="relative">
        <p className="text-[11px] font-medium tracking-[0.34em] text-[#8B8C74] uppercase">Nosotros</p>
        <AboutTitleMark />

        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-5 sm:mt-10">
          {STATS.map((stat) => (
            <div key={stat.note}>
              <p className="font-serif text-[clamp(2.4rem,5vw,3.4rem)] leading-none text-[#C45C3E]">
                {stat.value}
              </p>
              <p className="mt-1 text-[10px] font-medium tracking-[0.22em] text-[#8B8C74] uppercase">
                {stat.label}
              </p>
              <p className="text-sm text-[#2B1A18]/70">{stat.note}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-md text-[15px] leading-relaxed text-[#2B1A18]/78 sm:mt-10 sm:text-base">
          En Puertas del Sol, La Vilet nace para vivir y emprender en un solo sitio: comercio abajo,
          residencias arriba, con accesos independientes y una arquitectura que no interrumpe el
          paisaje.
        </p>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#2B1A18]/68 sm:text-base">
          Contemporánea, limpia y atemporal. El Tomebamba queda a unos pasos; la ciudad, de vuelta.
        </p>

        <Link
          href="/contacto"
          className="mt-8 inline-flex items-center text-[13px] font-semibold tracking-[0.04em] text-[#72735A] hover:text-[#C45C3E]"
        >
          Agendar visita
          <ArrowRight size={16} className="ml-1.5" />
        </Link>
      </div>
    </article>
  )
}

function CardsPanel({ full = false }: { full?: boolean }) {
  return (
    <article
      className={cn(
        'relative flex h-full shrink-0 flex-col justify-center overflow-hidden bg-[#efece4] px-7 py-12 sm:px-12 lg:px-14',
        full ? 'min-h-[32rem] w-full' : 'w-[min(100vw,40rem)] sm:w-[52vw] lg:w-[44vw]',
      )}
    >
      <PaperGrain />
      <div className="relative">
        <p className="text-[11px] font-medium tracking-[0.34em] text-[#8B8C74] uppercase">El lugar</p>
        <h2 className="mt-3 font-serif text-[clamp(2.4rem,6vw,4.2rem)] leading-[0.9] font-normal tracking-[-0.04em] text-[#72735A]">
          A unos pasos
        </h2>
        <div className="mt-8 space-y-4">
          {PLACE_CARDS.map((place) => (
            <div
              key={place.id}
              className="rounded-[1.15rem] bg-[#f7f4ee]/85 px-5 py-4 ring-1 ring-[#72735A]/10"
            >
              <p className="text-[10px] font-medium tracking-[0.22em] text-[#C45C3E] uppercase">
                {place.tag}
              </p>
              <h3 className="mt-1 font-serif text-2xl leading-tight tracking-[-0.03em] text-[#72735A]">
                {place.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-[#2B1A18]/68">{place.body}</p>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function Track({
  onRelease,
  trackRef,
}: {
  onRelease: () => void
  trackRef?: Ref<HTMLDivElement>
}) {
  return (
    <div ref={trackRef} className="flex h-full w-max gap-1.5">
      <PhotoPanel slide={PHOTOS[0]} />
      <PhotoPanel slide={PHOTOS[1]} />
      <AboutPanel />
      <PhotoPanel slide={PHOTOS[2]} />
      <CardsPanel />
      <PhotoPanel slide={PHOTOS[3]} />
      <PhotoPanel slide={PHOTOS[4]} onRelease={onRelease} />
    </div>
  )
}

function StackedGallery({
  onRelease,
  sectionRef,
}: {
  onRelease: () => void
  sectionRef: Ref<HTMLElement>
}) {
  return (
    <section
      ref={sectionRef}
      className="relative z-20 space-y-1.5 bg-[#e4e4de] mkt-dark:bg-[#72735A]"
      aria-label="La ciudad alrededor"
    >
      <div className="relative h-[78vh] min-h-[28rem]">
        <PhotoPanel slide={{ ...PHOTOS[0], width: 'w-full' }} />
      </div>
      <div className="relative min-h-[32rem]">
        <AboutPanel full />
      </div>
      <div className="relative h-[72vh] min-h-[24rem]">
        <PhotoPanel slide={{ ...PHOTOS[1], width: 'w-full' }} />
      </div>
      <div className="relative min-h-[28rem]">
        <CardsPanel full />
      </div>
      <div className="relative h-[72vh] min-h-[24rem]">
        <PhotoPanel slide={{ ...PHOTOS[2], width: 'w-full' }} />
      </div>
      <div className="relative h-[72vh] min-h-[24rem]">
        <PhotoPanel slide={{ ...PHOTOS[3], width: 'w-full' }} />
      </div>
      <div className="relative h-[78vh] min-h-[28rem]">
        <PhotoPanel slide={{ ...PHOTOS[4], width: 'w-full' }} onRelease={onRelease} />
      </div>
    </section>
  )
}

export function PlaceGallery() {
  const reduce = useReducedMotion()
  const pinRef = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [travel, setTravel] = useState(0)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return

    const measure = () => {
      setTravel(Math.max(0, track.scrollWidth - window.innerWidth))
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(track)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [reduce])

  const { scrollYProgress } = useScroll({
    target: pinRef,
    offset: ['start start', 'end end'],
  })
  const x = useTransform(scrollYProgress, [0, 1], [0, -travel])

  function releasePin() {
    const node = pinRef.current
    if (!node) {
      document.querySelector('footer')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    const top = node.getBoundingClientRect().top + window.scrollY + node.offsetHeight
    window.scrollTo({ top, behavior: 'smooth' })
  }

  if (reduce) {
    return <StackedGallery onRelease={releasePin} sectionRef={pinRef} />
  }

  return (
    <section
      ref={pinRef}
      className="relative z-20"
      style={{ height: `calc(100svh + ${travel || 2800}px)` }}
      aria-label="La ciudad alrededor"
    >
      <div className="sticky top-0 h-svh overflow-hidden bg-[#e4e4de] mkt-dark:bg-[#72735A]">
        <motion.div className="h-full will-change-transform" style={{ x }}>
          <Track trackRef={trackRef} onRelease={releasePin} />
        </motion.div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-black/10 mkt-dark:bg-white/10">
          <motion.div
            className="h-full origin-left bg-[#C45C3E]"
            style={{ scaleX: scrollYProgress }}
          />
        </div>
      </div>
    </section>
  )
}

export function LaviletPlaceBoard() {
  return <PlaceGallery />
}
