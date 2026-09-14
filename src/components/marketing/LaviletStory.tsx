'use client'

import { useId, useRef, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { cn } from '@/lib/utils'
import { LaviletLockup, useLockupDocked } from './LaviletLockup'

const LINES = [
  'El hormigón se curva para no interrumpir el paisaje.',
  'La madera guarda la luz que entra por la tarde.',
  'Cada planta orientada a la luz del Tomebamba.',
  'Y cada balcón se abre hacia el verde, como quien no tiene prisa.',
  'Lo que se admira desde la calle es, adentro, un día cualquiera.',
]

const INTERIOR = {
  featured: '/lavilet-exterior.jpg',
  terraza:
    'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/lavilet_terraza.png',
} as const

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
  const from = invert ? 14 : -14
  const to = invert ? -14 : 14

  return (
    <motion.div
      className={cn('story-air h-full', className)}
      animate={
        reduce
          ? undefined
          : { rotateY: [from, to], rotateX: [2.5, 5, 2.5], y: [0, -12, 0] }
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
        <h3 className="absolute inset-x-0 bottom-0 p-5 font-display text-[1.45rem] leading-[1.12] font-semibold text-white sm:p-6 sm:text-2xl">
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
      className="relative z-0 min-h-[16rem] hover:z-20 sm:min-h-[18rem] lg:min-h-0 lg:flex-1"
      style={{ x, opacity }}
    >
      <AirPiece
        delay={0.35}
        className="flex flex-col justify-between rounded-[1.6rem] bg-[#ffffff] p-6 text-[#72735A] shadow-[0_18px_40px_-28px_rgba(114,115,90,0.22)] ring-1 ring-[#72735A]/10 sm:p-7 mkt-dark:bg-[#8B8C74] mkt-dark:text-[#F2F2F2] mkt-dark:ring-[#F2F2F2]/12"
      >
        <div>
          <p className="text-[11px] font-medium tracking-[0.22em] text-[#8B8C74] uppercase">Showroom</p>
          <h3 className="mt-3 font-display text-[1.65rem] leading-[1.1] font-semibold sm:text-[1.85rem]">
            {title}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-[#2B1A18]/65 mkt-dark:text-[#f4efe8]/65">{body}</p>
        </div>
        <Link
          href={href}
          className="mt-6 inline-flex items-center text-[13px] font-semibold tracking-[0.04em] text-[#72735A] transition-colors hover:text-[#8B8C74] mkt-dark:text-[#F2F2F2]"
        >
          {cta}
          <ArrowRight size={16} className="ml-1.5" />
        </Link>
      </AirPiece>
    </motion.article>
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
  const { scrollYProgress } = useScroll({
    target: boardRef,
    offset: ['start 0.98', 'start 0.28'],
  })

  const idle = reduceMotion ? 0 : 1
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
        className="relative z-0 min-h-[22rem] hover:z-20 sm:min-h-[28rem] lg:min-h-[38rem]"
        style={{ x: leftX, opacity: leftOpacity }}
      >
        <AirPiece invert className="relative h-full min-h-[22rem] sm:min-h-[28rem] lg:min-h-[38rem]">
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
            stepped && 'bottom-0 right-0',
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
                ? 'bg-gradient-to-t from-black/35 via-transparent to-black/10'
                : 'bg-gradient-to-t from-black/80 via-black/15 to-black/10',
            )}
          />
        </div>
        <div
          className={cn(
            'absolute z-10',
            stepped
              ? 'bottom-0 left-0 w-fit max-w-[min(100%,21rem)] px-1 pb-1 pt-3 sm:max-w-[min(100%,24rem)] lg:max-w-[min(52%,26rem)]'
              : 'inset-x-0 bottom-0 p-6 sm:p-8 lg:p-10',
          )}
        >
          <p className="text-[11px] font-medium tracking-[0.28em] text-[#8B8C74] uppercase">
            {eyebrow}
          </p>
          <h2
            className={cn(
              'mt-2 font-display leading-[0.95] font-semibold tracking-tight',
              stepped
                ? 'text-[2.35rem] text-[#2B1A18] sm:text-5xl lg:text-[3.15rem] mkt-dark:text-[#f4efe8]'
                : 'max-w-xl text-[2.1rem] text-white sm:text-5xl lg:text-[3.35rem]',
            )}
          >
            {heading}
          </h2>
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
            object: 'object-bottom',
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
      </div>
    </section>
  )
}

export function LaviletPlaceBoard() {
  return (
    <section className="relative z-20 pb-16 lg:pb-24">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
        <StoryBoard
          eyebrow="Nosotros"
          heading={
            <>
              un lugar donde
              <span className="block">el tiempo se detiene</span>
            </>
          }
          featured={{
            src: '/CUENCA2.png',
            alt: 'Cuenca desde las alturas',
            stepped: true,
          }}
          cards={[
            {
              src: '/CUENCA4.png',
              alt: 'El río Tomebamba en Cuenca',
              title: 'El Tomebamba, a unos pasos',
            },
            {
              src: '/CUENCA3.jpg',
              alt: 'El centro histórico de Cuenca',
              title: 'La ciudad, de vuelta',
            },
          ]}
        />
      </div>
    </section>
  )
}
