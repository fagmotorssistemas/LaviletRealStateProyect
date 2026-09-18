'use client'

import { useLayoutEffect, useRef, useState, type Ref } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'
import { NEARBY_PLACES } from '@/lib/marketing/nearbyPlaces'
import { LaviletLockup } from './LaviletLockup'
import { AboutTitleMark } from './FooterWordmark'

const TERRAZA =
  'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/lavilet_terraza.png'

const STATS = [
  { value: '1', label: 'sector', note: 'Puertas del Sol' },
  { value: '2', label: 'vidas', note: 'vivir y emprender' },
  { value: '3', label: 'ríos', note: 'Tomebamba' },
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
    src: 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/comerciales_lavilet.png',
    alt: 'Área comercial de La Vilet',
    kicker: 'Comercio',
    title: 'Dinamismo y convivencia',
    credit: 'Locales comerciales',
    width: 'w-[80vw] sm:w-[70vw] lg:w-[64vw]',
    object: 'object-cover object-center',
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

const VIVIENDA_STATS = [
  {
    count: '36',
    type: 'suites',
    floors: '(planta baja - plantas 2-3-4-5)',
    desc: 'Suites 1 dormitorio, 1 Baño, Sala, Comedor, Cocina, Área de Lavado, Balcón, Bodega, 1 parqueadero subterraneo.',
    price: 'Desde 49,86m²',
  },
  {
    count: '7',
    type: 'dptos. 2hab',
    floors: '(plantas 3-4-5-6)',
    desc: 'Departamentos de 2 Dormitorios, 2 Baños, Sala, Comedor, Cocina, Área de Lavado, Balcón, Bodega, 1 Parqueadero subterraneo.',
    price: 'Desde 99,71m²',
  },
  {
    count: '6',
    type: 'dptos. 3hab',
    floors: '(plantas 2-3-4-5-6)',
    desc: 'Departamentos de 3 Dormitorios, 2.5 - 3.5 Baños, Sala, Comedor, Cocina, Área de Lavado, Balcón/Terraza, Bodega y 1 o 2 parqueaderos subterráneos según tipología.',
    price: 'Desde 120,83m²',
  },
]

function CardsPanel({ full = false }: { full?: boolean }) {
  const reduce = useReducedMotion()

  return (
    <article
      className={cn(
        'relative flex h-full shrink-0 flex-col justify-center overflow-hidden bg-[#efece4] px-7 py-12 sm:px-12 lg:px-16',
        full ? 'min-h-[32rem] w-full' : 'w-[min(100vw,42rem)] sm:w-[56vw] lg:w-[48vw]',
      )}
    >
      <div className="relative flex flex-col items-center text-center">
        <motion.div 
          className="scale-[0.8] sm:scale-90 lg:scale-100"
          initial={reduce ? false : { x: -100, opacity: 0 }}
          whileInView={reduce ? undefined : { x: 0, opacity: 1 }}
          viewport={{ once: false, amount: 0.3 }}
          transition={{ type: 'spring', stiffness: 280, damping: 25, duration: 0.8 }}
        >
          <LaviletLockup variant="story" noLayoutId />
        </motion.div>
        <p className="mt-4 sm:mt-6 text-[11px] sm:text-[13px] font-medium tracking-[0.2em] text-[#8B8C74] uppercase">
          49 unidades de vivienda
        </p>
        
        <div className="mt-10 sm:mt-16 grid w-full grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6 lg:gap-10">
          {VIVIENDA_STATS.map((stat, i) => (
            <div key={i} className="flex flex-col items-center">
              <p className="font-serif text-[clamp(2.8rem,5vw,3.8rem)] leading-none text-[#72735A]">
                {stat.count}
              </p>
              <p className="mt-2 text-[1.1rem] sm:text-[1.3rem] font-medium tracking-wide text-[#72735A] text-center">
                {stat.type}
              </p>
              <p className="mt-2 text-[10px] sm:text-[11px] text-[#8B8C74] text-center">
                {stat.floors}
              </p>
              
              <div className="my-5 sm:my-6 h-1 w-full max-w-[8rem] sm:max-w-none bg-[#72735A]" />
              
              <p className="text-[12px] sm:text-[13px] lg:text-[14px] leading-relaxed text-[#2B1A18]/70 text-center sm:text-left">
                {stat.desc}
              </p>
              
              <p className="mt-4 sm:mt-auto pt-2 sm:pt-6 text-[13px] sm:text-[14px] text-[#8B8C74]">
                {stat.price}
              </p>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function CommercePanel({ full = false }: { full?: boolean }) {
  const reduce = useReducedMotion()

  return (
    <article
      className={cn(
        'relative flex h-full shrink-0 flex-col justify-center overflow-hidden bg-[#efece4] px-7 py-12 sm:px-12 lg:px-16',
        full ? 'min-h-[32rem] w-full' : 'w-[min(100vw,42rem)] sm:w-[56vw] lg:w-[48vw]',
      )}
    >
      <div className="relative flex flex-col items-center text-center">
        <motion.div 
          className="scale-[0.8] sm:scale-90 lg:scale-100 mb-6"
          initial={reduce ? false : { y: -100, opacity: 0, scale: 0.5 }}
          whileInView={reduce ? undefined : { y: 0, opacity: 1, scale: 1 }}
          viewport={{ once: false, amount: 0.3 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20, duration: 0.8 }}
        >
          <LaviletLockup variant="story" noLayoutId />
        </motion.div>
        
        <motion.div 
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.3 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          <h2 className="font-serif text-[clamp(2.5rem,5vw,4rem)] leading-none font-normal tracking-[-0.02em] text-[#72735A]">
            comercio
          </h2>
        </motion.div>
        
        <motion.p 
          initial={reduce ? false : { opacity: 0 }}
          whileInView={reduce ? undefined : { opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="mt-4 sm:mt-6 text-[11px] sm:text-[13px] font-medium tracking-[0.2em] text-[#8B8C74] uppercase"
        >
          16 unidades
        </motion.p>
        
        <div className="mt-8 sm:mt-12 flex flex-col gap-6 sm:gap-8 max-w-lg">
          <motion.p 
            initial={reduce ? false : { opacity: 0, x: 30 }}
            whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
            viewport={{ once: false, amount: 0.1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="text-[14px] sm:text-[15px] lg:text-[16px] leading-relaxed text-[#2B1A18]/80"
          >
            Diseñado para ofrecer funcionalidad, visibilidad y autonomía. 16 unidades comerciales distribuidas en dos plantas.
          </motion.p>
          <motion.p 
            initial={reduce ? false : { opacity: 0, x: -30 }}
            whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
            viewport={{ once: false, amount: 0.1 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="text-[14px] sm:text-[15px] lg:text-[16px] leading-relaxed text-[#2B1A18]/80"
          >
            Presencia urbana estratégica que aporta dinamismo al entorno, ideal para diferentes negocios y servicios.
          </motion.p>
          <motion.p 
            initial={reduce ? false : { opacity: 0, y: 30 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.1 }}
            transition={{ delay: 1.0, duration: 0.6 }}
            className="text-[14px] sm:text-[15px] lg:text-[16px] leading-relaxed text-[#2B1A18]/80"
          >
            Acceso completamente independiente al ingreso residencial, garantizando privacidad y una circulación organizada sin interferir con las viviendas.
          </motion.p>
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
    <div ref={trackRef} className="flex h-full w-max">
      <PhotoPanel slide={PHOTOS[0]} />
      <PhotoPanel slide={PHOTOS[1]} />
      <AboutPanel />
      <PhotoPanel slide={PHOTOS[2]} />
      <CardsPanel />
      <PhotoPanel slide={PHOTOS[3]} />
      <CommercePanel />
      <PhotoPanel slide={PHOTOS[4]} />
      <PhotoPanel slide={PHOTOS[5]} onRelease={onRelease} />
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
      className="relative z-20 space-y-1.5 bg-[#e4e4de] pb-20 mkt-dark:bg-[#72735A] sm:pb-28"
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
      <div className="relative min-h-[32rem]">
        <CommercePanel full />
      </div>
      <div className="relative h-[72vh] min-h-[24rem]">
        <PhotoPanel slide={{ ...PHOTOS[4], width: 'w-full' }} />
      </div>
      <div className="relative h-[78vh] min-h-[28rem] z-10">
        <PhotoPanel slide={{ ...PHOTOS[5], width: 'w-full' }} onRelease={onRelease} />
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
