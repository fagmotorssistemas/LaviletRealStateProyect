'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { motion, useInView, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { cn } from '@/lib/utils'
import { LaviletLockup, useLockupDocked } from './LaviletLockup'

const LINES = [
  'El hormigón se curva para no interrumpir el paisaje.',
  'La madera guarda la luz que entra por la tarde.',
  'Cada planta orientada a la luz del Tomebamba.',
  'Y cada balcón se abre hacia el verde, como quien no tiene prisa.',
  'Lo que se admira desde la calle es, adentro, un día cualquiera.',
]

const ABOUT = [
  'La Vilet, Suites & Apartments, se encuentra ubicado en una de las zonas residenciales más privilegiadas de la ciudad, en el sector Puertas del Sol.',
  'La Vilet nace como un proyecto de uso mixto que redefine la forma de vivir y emprender en un solo lugar. Su propuesta integra espacios comerciales dinámicos distribuidos en planta baja y primera planta alta con modernas unidades residenciales en los niveles superiores, creando un entorno funcional, cómodo y lleno de vida, manteniendo la privacidad por medio de sus accesos independientes para el área comercial y de vivienda.',
  'Su diseño nace de un concepto contemporáneo, resaltando su arquitectura limpia, elegante y atemporal, donde cada detalle ha sido cuidadosamente pensado para ofrecer bienestar, iluminación natural y una conexión armoniosa con el entorno.',
]

const ABOUT_BEATS = [
  {
    kicker: 'El lugar',
    lead: 'La Vilet, Suites & Apartments, está en una de las zonas residenciales más',
    lines: ['privilegiadas'],
    tone: 'text-[#72735A] mkt-dark:text-[#F2F2F2]',
    align: 'text-left sm:text-right',
    note: 'de la ciudad: el sector Puertas del Sol, en Cuenca.',
  },
  {
    kicker: 'El proyecto',
    lead: 'Nace para vivir y emprender en un solo sitio. Comercio en planta baja y primera alta; residencias arriba, con accesos independientes. Así se crea un',
    lines: ['entorno', 'funcional'],
    tone: 'text-[#C45C3E]',
    align: 'text-left',
    note: ', cómodo y lleno de vida, con privacidad para quien habita y movimiento para quien emprende.',
  },
  {
    kicker: 'El diseño',
    lead: 'Ese lugar se dibuja desde un concepto',
    lines: ['contemporáneo'],
    tone: 'text-[#BDA27E]',
    align: 'text-left sm:text-right',
    note: 'Arquitectura limpia, elegante y atemporal, pensada para el bienestar y la luz que entra.',
  },
  {
    kicker: 'El paisaje',
    lead: 'El resultado es una conexión',
    lines: ['armoniosa', 'con el entorno'],
    tone: 'text-[#72735A] mkt-dark:text-[#F2F2F2]',
    align: 'text-left',
    note: 'Nada interrumpe el Tomebamba ni el verde de alrededor: se habita con el paisaje, no contra él.',
  },
] as const

const kineticEase = [0.22, 1, 0.36, 1] as const

function KineticWord({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { amount: 0.55, once: false })
  const words = text.split(/\s+/).filter(Boolean)

  return (
    <motion.span
      ref={ref}
      className={cn('inline-block', className)}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: reduce ? 0 : 0.1 } },
      }}
    >
      {words.map((word, index) => (
        <motion.span
          key={`${word}-${index}`}
          className="mr-[0.22em] inline-block origin-bottom last:mr-0"
          variants={{
            hidden: reduce ? { opacity: 0.4 } : { opacity: 0, y: 20, filter: 'blur(7px)' },
            show: {
              opacity: 1,
              y: 0,
              filter: 'blur(0px)',
              transition: { duration: reduce ? 0.2 : 0.7, ease: kineticEase },
            },
          }}
        >
          {word}
        </motion.span>
      ))}
    </motion.span>
  )
}

function AboutEditorial() {
  const reduce = useReducedMotion()

  return (
    <div className="relative mx-auto max-w-5xl">
      <p className="sr-only">{ABOUT.join(' ')}</p>
      <p
        aria-hidden
        className="pointer-events-none absolute top-[8%] left-0 font-serif text-[clamp(5.5rem,18vw,13rem)] leading-none text-[#72735A]/[0.07] select-none mkt-dark:text-[#F2F2F2]/[0.08]"
      >
        LaVilēt
      </p>

      <div className="relative space-y-10 sm:space-y-14 lg:space-y-16" aria-hidden="true">
        {ABOUT_BEATS.map((beat, index) => (
          <motion.article
            key={beat.kicker}
            className={cn('grid gap-2 sm:gap-3', beat.align)}
            initial={reduce ? false : { opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.7, delay: 0.05, ease: kineticEase }}
          >
            <p className="text-[11px] font-medium tracking-[0.34em] text-[#8B8C74] uppercase mkt-dark:text-[#BFBFB8]">
              {beat.kicker}
            </p>
            <p
              className={cn(
                'max-w-lg text-[15px] leading-relaxed text-[#2B1A18]/70 sm:text-base mkt-dark:text-[#F2F2F2]/72',
                beat.align.includes('right') && 'sm:ml-auto',
              )}
            >
              {beat.lead}
            </p>
            <h3
              className={cn(
                'font-serif font-normal tracking-[-0.045em] leading-[0.84]',
                beat.tone,
                beat.lines.length > 1
                  ? 'text-[clamp(2.35rem,8.6vw,6.1rem)]'
                  : 'text-[clamp(2.85rem,11vw,7.2rem)]',
              )}
            >
              {beat.lines.map((line) => (
                <span key={line} className="block">
                  <KineticWord text={line} />
                </span>
              ))}
            </h3>
            <motion.p
              className={cn(
                'max-w-md text-[15px] leading-relaxed text-[#2B1A18]/70 sm:text-base mkt-dark:text-[#F2F2F2]/72',
                beat.align.includes('right') && 'sm:ml-auto',
              )}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.8 }}
              transition={{ duration: 0.7, delay: 0.22, ease: kineticEase }}
            >
              {beat.note}
            </motion.p>
          </motion.article>
        ))}
      </div>
    </div>
  )
}

const INTERIOR = {
  featured: '/lavilet-exterior.jpg',
  terraza:
    'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/lavilet_terraza.png',
} as const

function useWideBoard() {
  const [wide, setWide] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return wide
}

function AirPiece({
  children,
  className,
  delay = 0,
  invert = false,
}: {
  children: ReactNode
  className?: string
  delay?: number
  invert?: boolean
}) {
  const reduce = useReducedMotion()
  const wide = useWideBoard()
  const swing = wide ? 14 : 3.5
  const from = invert ? swing : -swing
  const to = invert ? -swing : swing

  return (
    <motion.div
      className={cn('story-air h-full', className)}
      animate={
        reduce
          ? undefined
          : { rotateY: [from, to], rotateX: wide ? [2.5, 5, 2.5] : [0.6, 1.4, 0.6], y: [0, wide ? -12 : -6, 0] }
      }
      transition={
        reduce
          ? undefined
          : {
              duration: 8.2 + delay,
              delay,
              repeat: Infinity,
              repeatType: 'mirror',
              ease: 'easeInOut',
            }
      }
      whileHover={{
        scale: 1.03,
        rotateY: 0,
        rotateX: 1,
        y: -8,
        transition: { type: 'spring', stiffness: 200, damping: 28 },
      }}
    >
      {children}
    </motion.div>
  )
}

function StoryCard({
  src,
  alt,
  title,
  className,
  x,
  opacity,
  delay = 0,
  invert = false,
}: {
  src: string
  alt: string
  title: string
  className?: string
  x: MotionValue<number>
  opacity: MotionValue<number>
  delay?: number
  invert?: boolean
}) {
  return (
    <motion.article
      className={cn(
        'relative z-0 min-h-[16rem] hover:z-20 sm:min-h-[18rem] lg:min-h-0 lg:flex-1',
        className,
      )}
      style={{ x, opacity }}
    >
      <AirPiece delay={delay} invert={invert} className="relative overflow-hidden rounded-[1.6rem]">
        <Image
          src={src}
          alt={alt}
          fill
          className="object-cover"
          sizes="(max-width: 1024px) 100vw, 28vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <h3 className="absolute inset-x-0 bottom-0 p-5 font-display text-[1.35rem] leading-[1.15] font-semibold text-white sm:p-6 sm:text-2xl">
          {title}
        </h3>
      </AirPiece>
    </motion.article>
  )
}

function PromoCard({
  title,
  body,
  href,
  cta,
  x,
  opacity,
}: {
  title: string
  body: string
  href: string
  cta: string
  x: MotionValue<number>
  opacity: MotionValue<number>
}) {
  return (
    <motion.article
      className="relative z-0 min-h-0 hover:z-20 sm:min-h-[18rem] lg:min-h-0 lg:flex-1"
      style={{ x, opacity }}
    >
      <AirPiece
        delay={0.35}
        className="flex h-full flex-col justify-between rounded-[1.6rem] bg-[#ffffff] p-5 text-[#72735A] shadow-[0_18px_40px_-28px_rgba(114,115,90,0.22)] ring-1 ring-[#72735A]/10 sm:p-7 mkt-dark:bg-[#8B8C74] mkt-dark:text-[#F2F2F2] mkt-dark:ring-[#F2F2F2]/12"
      >
        <div>
          <p className="text-[11px] font-medium tracking-[0.22em] text-[#8B8C74] uppercase mkt-dark:text-[#F2F2F2]/75">Showroom</p>
          <h3 className="mt-2.5 font-display text-[1.55rem] leading-[1.12] font-semibold sm:mt-3 sm:text-[1.85rem]">
            {title}
          </h3>
          <p className="mt-2.5 text-sm leading-relaxed text-[#2B1A18]/65 sm:mt-3 mkt-dark:text-[#f4efe8]/65">
            {body}
          </p>
        </div>
        <Link
          href={href}
          className="mt-5 inline-flex items-center text-[13px] font-semibold tracking-[0.04em] text-[#72735A] transition-colors hover:text-[#8B8C74] sm:mt-6 mkt-dark:text-[#F2F2F2]"
        >
          {cta}
          <ArrowRight size={16} className="ml-1.5" />
        </Link>
      </AirPiece>
    </motion.article>
  )
}

function StoryHeading({
  eyebrow,
  heading,
  stepped,
}: {
  eyebrow: string
  heading: ReactNode
  stepped: boolean
}) {
  return (
    <>
      <p
        className={cn(
          'text-[11px] font-medium tracking-[0.28em] uppercase',
          stepped
            ? 'text-[#8B8C74] mkt-dark:text-[#F2F2F2]/75 lg:mkt-dark:text-[#BFBFB8]'
            : 'text-white/80',
        )}
      >
        {eyebrow}
      </p>
      <h2
        className={cn(
          'mt-2 font-display leading-[0.96] font-semibold tracking-tight text-balance',
          stepped
            ? 'text-[clamp(1.72rem,7.6vw,2.35rem)] leading-[1.04] text-[#2B1A18] lg:text-[3.15rem] lg:leading-[0.96] mkt-dark:text-[#f4efe8]'
            : 'max-w-xl text-[clamp(1.7rem,7.2vw,2.1rem)] text-white sm:text-5xl lg:text-[3.35rem]',
        )}
      >
        {heading}
      </h2>
    </>
  )
}

export function StoryBoard({
  className,
  eyebrow,
  heading,
  featured,
  promo,
  cards,
}: {
  className?: string
  eyebrow: string
  heading: ReactNode
  featured: { src: string; alt: string; object?: string; stepped?: boolean }
  promo?: { title: string; body: string; href: string; cta: string }
  cards: { src: string; alt: string; title: string }[]
}) {
  const clipId = `story-step-${useId().replace(/:/g, '')}`
  const stepped = Boolean(featured.stepped)
  const boardRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const wide = useWideBoard()
  const { scrollYProgress } = useScroll({
    target: boardRef,
    offset: ['start 0.98', 'start 0.28'],
  })

  const idle = reduceMotion ? 0 : wide ? 1 : 0.32
  const leftX = useTransform(scrollYProgress, [0, 0.62], [-200 * idle, 0])
  const leftOpacity = useTransform(scrollYProgress, [0, 0.28], [reduceMotion ? 1 : 0, 1])
  const promoX = useTransform(scrollYProgress, [0.14, 0.78], [170 * idle, 0])
  const promoOpacity = useTransform(scrollYProgress, [0.14, 0.4], [reduceMotion ? 1 : 0, 1])
  const card0X = useTransform(scrollYProgress, [0.28, 0.9], [190 * idle, 0])
  const card0Opacity = useTransform(scrollYProgress, [0.28, 0.52], [reduceMotion ? 1 : 0, 1])
  const card1X = useTransform(scrollYProgress, [0.4, 1], [190 * idle, 0])
  const card1Opacity = useTransform(scrollYProgress, [0.4, 0.64], [reduceMotion ? 1 : 0, 1])
  const cardMotion = [
    { x: card0X, opacity: card0Opacity },
    { x: card1X, opacity: card1Opacity },
  ]

  return (
    <div
      ref={boardRef}
      className={cn(
        'relative story-board-air grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.72fr)] lg:gap-5',
        className,
      )}
    >
      <motion.article
        className={cn(
          'relative z-0 hover:z-20',
          stepped
            ? 'min-h-[26rem] h-[min(32rem,70svh)] sm:h-auto sm:min-h-[28rem] lg:min-h-[38rem]'
            : 'min-h-[22rem] sm:min-h-[28rem] lg:min-h-[38rem]',
        )}
        style={{ x: leftX, opacity: leftOpacity }}
      >
        <AirPiece
          invert
          className={cn(
            'relative h-full',
            stepped
              ? 'min-h-[26rem] h-[min(32rem,70svh)] sm:h-auto sm:min-h-[28rem] lg:h-full lg:min-h-[38rem]'
              : 'min-h-[22rem] sm:min-h-[28rem] lg:min-h-[38rem]',
          )}
        >
          {stepped ? (
            <svg className="pointer-events-none absolute h-0 w-0" aria-hidden>
              <defs>
                <clipPath id={clipId} clipPathUnits="objectBoundingBox">
                  <path d="M0 0 H1 V1 H0.55 V0.82 Q0.55 0.78 0.51 0.78 H0.24 V0.64 Q0.24 0.6 0.2 0.6 H0 Z" />
                </clipPath>
              </defs>
            </svg>
          ) : null}
          <div
            className={cn(
              'absolute inset-0 overflow-hidden rounded-[1.75rem]',
              stepped && 'story-featured-photo',
            )}
            style={stepped ? { clipPath: `url(#${clipId})` } : undefined}
          >
            <Image
              src={featured.src}
              alt={featured.alt}
              fill
              className={cn('object-cover', featured.object ?? 'object-center')}
              sizes="(max-width: 1024px) 100vw, 62vw"
            />
            <div
              className={cn(
                'absolute inset-0',
                stepped
                  ? 'bg-gradient-to-t from-black/25 via-transparent to-black/10 lg:from-black/35'
                  : 'bg-gradient-to-t from-black/80 via-black/15 to-black/10',
              )}
            />
          </div>
          <div
            className={cn(
              'absolute z-10',
              stepped
                ? [
                    'inset-x-3 bottom-3 max-w-none rounded-[1.35rem] bg-[#ffffff] p-5',
                    'shadow-[0_18px_40px_-28px_rgba(114,115,90,0.28)] ring-1 ring-[#72735A]/10',
                    'sm:inset-x-auto sm:left-4 sm:right-auto sm:bottom-4 sm:max-w-[22.5rem] sm:p-6',
                    'lg:inset-auto lg:bottom-0 lg:left-0 lg:w-fit lg:max-w-[min(52%,26rem)]',
                    'lg:rounded-none lg:bg-transparent lg:p-0 lg:px-1 lg:pb-1 lg:pt-3',
                    'lg:shadow-none lg:ring-0',
                    'mkt-dark:bg-[#8B8C74] mkt-dark:ring-[#F2F2F2]/12 lg:mkt-dark:bg-transparent',
                  ]
                : 'inset-x-0 bottom-0 p-6 sm:p-8 lg:p-10',
            )}
          >
            <StoryHeading eyebrow={eyebrow} heading={heading} stepped={stepped} />
          </div>
        </AirPiece>
      </motion.article>

      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2 lg:flex lg:gap-5">
        {promo ? <PromoCard {...promo} x={promoX} opacity={promoOpacity} /> : null}
        {cards.map((card, index) => (
          <StoryCard
            key={card.title}
            src={card.src}
            alt={card.alt}
            title={card.title}
            x={cardMotion[index]?.x ?? card0X}
            opacity={cardMotion[index]?.opacity ?? card0Opacity}
            delay={0.45 + index * 0.55}
            invert={index % 2 === 0}
          />
        ))}
      </div>
    </div>
  )
}

export function LaviletStory() {
  const docked = useLockupDocked()

  return (
    <section id="nosotros" className="relative z-20 scroll-mt-28 py-16 lg:py-24">
      <div className="relative z-10 mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
        <div className="grid items-end gap-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-10 lg:gap-12">
          <div className="flex min-h-[9rem] min-w-[16rem] items-end sm:min-h-[12rem] sm:min-w-[22rem]">
            {docked && <LaviletLockup variant="story" />}
          </div>

          <p className="max-w-lg pb-1 font-sans text-[clamp(1.02rem,1.45vw,1.2rem)] font-semibold leading-[1.45] tracking-[-0.02em] text-[#72735A] mkt-dark:text-[#F2F2F2]">
            {LINES.map((line) => (
              <span key={line} className="mt-2 block first:mt-0">
                {line}
              </span>
            ))}
          </p>
        </div>

        <StoryBoard
          className="mt-12 lg:mt-16"
          eyebrow="El espacio"
          heading={
            <>
              madera, luz
              <span className="block">y un día cualquiera</span>
            </>
          }
          featured={{
            src: INTERIOR.featured,
            alt: 'Fachada y exteriores de La Vilet',
            object: 'object-[center_40%] lg:object-bottom',
            stepped: true,
          }}
          promo={{
            title: 'Conoce el espacio',
            body: 'Recorre las suites en 360°, mira acabados y agenda una visita cuando quieras.',
            href: '/tour',
            cta: 'Abrir showroom',
          }}
          cards={[
            {
              src: INTERIOR.terraza,
              alt: 'Terraza rooftop de La Vilet',
              title: 'La terraza, sobre la ciudad',
            },
          ]}
        />

        <aside
          className={cn(
            'relative mt-10 w-full overflow-hidden rounded-[1.75rem] px-6 py-16 sm:mt-12 sm:px-8 sm:py-20 lg:mt-14 lg:px-12 lg:py-24',
            'bg-[linear-gradient(165deg,rgba(114,115,90,0.28),rgba(139,140,116,0.16)_46%,rgba(114,115,90,0.24))]',
            'ring-1 ring-[#72735A]/16 backdrop-blur-md',
            'mkt-dark:bg-[linear-gradient(165deg,rgba(242,242,242,0.1),rgba(139,140,116,0.22)_48%,rgba(242,242,242,0.08))]',
            'mkt-dark:ring-[#F2F2F2]/14',
          )}
        >
          <AboutEditorial />
        </aside>
      </div>
    </section>
  )
}

export { LaviletPlaceBoard } from './PlaceGallery'
