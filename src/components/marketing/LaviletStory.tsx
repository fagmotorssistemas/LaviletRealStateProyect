'use client'

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { cn } from '@/lib/utils'
import { LaviletLockup, useLockupDocked } from './LaviletLockup'
import { AboutLetterPlay } from './AboutLetterPlay'

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

function HeadlineSides({
  lines,
  invert = false,
}: {
  lines: readonly string[]
  invert?: boolean
}) {
  let offset = 0

  return (
    <>
      {lines.map((line) => {
        const words = line.split(/\s+/).filter(Boolean)
        const start = offset
        offset += words.length
        return (
          <span key={line} className="block">
            {words.map((word, i) => {
              const index = start + i
              const fromLeft = invert ? index % 2 === 1 : index % 2 === 0
              return (
                <motion.span
                  key={`${line}-${word}-${i}`}
                  className="mr-[0.18em] inline-block last:mr-0"
                  initial={{ x: fromLeft ? -64 : 64, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: fromLeft ? 48 : -48, opacity: 0 }}
                  transition={{ duration: 0.52, delay: index * 0.07, ease: kineticEase }}
                >
                  {word}
                </motion.span>
              )
            })}
          </span>
        )
      })}
    </>
  )
}

function AboutEditorial() {
  const reduce = useReducedMotion()
  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const beat = ABOUT_BEATS[active] ?? ABOUT_BEATS[0]
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start 80px', 'end end'] as any,
  })

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const next = Math.min(
      ABOUT_BEATS.length - 1,
      Math.max(0, Math.floor(value * ABOUT_BEATS.length)),
    )
    setActive((current) => (current === next ? current : next))
  })

  function goToBeat(index: number) {
    const track = trackRef.current
    if (!track) return
    const start = track.getBoundingClientRect().top + window.scrollY
    const range = Math.max(1, track.offsetHeight - window.innerHeight)
    const progress = (index + 0.15) / ABOUT_BEATS.length
    window.scrollTo({ top: start + range * progress, behavior: 'smooth' })
  }

  if (reduce) {
    return (
      <div className="relative mx-auto max-w-5xl space-y-10 py-4">
        <p className="sr-only">{ABOUT.join(' ')}</p>
        {ABOUT_BEATS.map((item) => (
          <article key={item.kicker} className={cn('grid gap-2', item.align)}>
            <p className="text-[11px] font-medium tracking-[0.34em] text-white/70 uppercase [text-shadow:0_2px_12px_rgba(20,14,10,0.5)]">
              {item.kicker}
            </p>
            <h3 className="font-serif text-[clamp(2.4rem,7vw,4.2rem)] leading-[0.88] tracking-[-0.045em] text-white [text-shadow:0_3px_20px_rgba(20,14,10,0.55)]">
              {item.lines.join(' ')}
            </h3>
            <p className="max-w-xl text-[17px] leading-[1.6] font-medium text-white [text-shadow:0_2px_16px_rgba(20,14,10,0.72)] sm:text-[19px]">
              {item.note}
            </p>
          </article>
        ))}
      </div>
    )
  }

  const card = (
    <div
      className={cn(
        'relative isolate w-full overflow-hidden rounded-[1.75rem] px-5 py-8 sm:px-8 sm:py-12 lg:px-12 lg:py-16',
        'bg-[linear-gradient(165deg,rgba(64,65,47,0.78),rgba(83,84,62,0.7)_46%,rgba(53,54,39,0.8))]',
        'shadow-[0_24px_70px_rgba(43,26,24,0.24)] ring-1 ring-white/14 backdrop-blur-md',
        'mkt-dark:bg-[linear-gradient(165deg,rgba(242,242,242,0.1),rgba(139,140,116,0.22)_48%,rgba(242,242,242,0.08))]',
        'mkt-dark:ring-[#F2F2F2]/14',
      )}
    >
      <p className="sr-only">{ABOUT.join(' ')}</p>
      <div className="relative z-20 mb-5 h-[6.5rem] sm:mb-7 sm:h-[7.25rem] lg:h-[8rem]">
        <AboutLetterPlay />
      </div>

      <div className="relative z-10 mx-auto min-h-[20rem] max-w-5xl sm:min-h-[24rem] lg:min-h-[27rem]">
        <AnimatePresence mode="sync">
          <motion.article
            key={beat.kicker}
            className={cn(
              'absolute inset-0 flex flex-col justify-center gap-2 sm:gap-3',
              beat.align,
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: kineticEase }}
          >
            <motion.p
              className="text-[11px] font-medium tracking-[0.34em] text-white/70 uppercase [text-shadow:0_2px_12px_rgba(20,14,10,0.5)]"
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 32, opacity: 0 }}
              transition={{ duration: 0.45, ease: kineticEase }}
            >
              {beat.kicker}
            </motion.p>
            <motion.p
              className={cn(
                'max-w-xl text-[17px] leading-[1.6] font-medium text-white [text-shadow:0_2px_16px_rgba(20,14,10,0.72)] sm:text-[19px]',
                beat.align.includes('right') && 'sm:ml-auto',
              )}
              initial={{ x: active % 2 === 0 ? -48 : 48, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: active % 2 === 0 ? 36 : -36, opacity: 0 }}
              transition={{ duration: 0.5, ease: kineticEase }}
            >
              {beat.lead}
            </motion.p>
            <h3
              className={cn(
                'font-serif font-normal tracking-[-0.045em] leading-[0.84] text-white [text-shadow:0_3px_20px_rgba(20,14,10,0.55)]',
                beat.lines.length > 1
                  ? 'text-[clamp(2rem,8vw,5.4rem)]'
                  : 'text-[clamp(2.35rem,9.5vw,6.4rem)]',
              )}
            >
              <HeadlineSides lines={beat.lines} invert={active % 2 === 0} />
            </h3>
            <motion.p
              className={cn(
                'max-w-xl text-[17px] leading-[1.6] font-medium text-white [text-shadow:0_2px_16px_rgba(20,14,10,0.72)] sm:text-[19px]',
                beat.align.includes('right') && 'sm:ml-auto',
              )}
              initial={{ x: active % 2 === 0 ? 48 : -48, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: active % 2 === 0 ? -36 : 36, opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.08, ease: kineticEase }}
            >
              {beat.note}
            </motion.p>
          </motion.article>
        </AnimatePresence>
      </div>

      <div className="relative mt-8 flex justify-center gap-2">
        {ABOUT_BEATS.map((item, index) => (
          <button
            key={item.kicker}
            type="button"
            aria-label={item.kicker}
            onClick={() => goToBeat(index)}
            className={cn(
              'h-1.5 rounded-full transition-all duration-300',
              index === active ? 'w-8 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60',
            )}
          />
        ))}
      </div>
    </div>
  )

  return (
    <div ref={trackRef} className="relative mt-10 sm:mt-12 lg:mt-14" style={{ height: `${ABOUT_BEATS.length * 85}svh` }}>
      <div className="sticky top-20 z-10">{card}</div>
    </div>
  )
}

const INTERIOR = {
  featured: '/lavilet-exterior.jpg',
  terraza:
    'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/lavilet_terraza.png',
  wall:
    'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/fondoooparalavilet.png',
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
  body,
  plain = false,
  kicker = 'El proyecto',
  className,
  x,
  opacity,
  delay = 0,
  invert = false,
}: {
  src: string
  alt: string
  title: string
  body?: string
  plain?: boolean
  kicker?: string
  className?: string
  x: MotionValue<number>
  opacity: MotionValue<number>
  delay?: number
  invert?: boolean
}) {
  if (plain) {
    return (
      <motion.article
        className={cn(
          'relative z-0 min-h-0 hover:z-20 sm:min-h-[18rem] lg:min-h-0 lg:flex-1',
          className,
        )}
        style={{ x, opacity }}
      >
        <AirPiece
          delay={delay}
          invert={invert}
          className="flex h-full flex-col justify-between rounded-[1.6rem] bg-[#ffffff] p-5 text-[#72735A] shadow-[0_18px_40px_-28px_rgba(114,115,90,0.22)] ring-1 ring-[#72735A]/10 sm:p-7 mkt-dark:bg-[#8B8C74] mkt-dark:text-[#F2F2F2] mkt-dark:ring-[#F2F2F2]/12"
        >
          <div>
            <p className="text-[11px] font-medium tracking-[0.22em] text-[#8B8C74] uppercase mkt-dark:text-[#F2F2F2]/75">
              {kicker}
            </p>
            <h3 className="mt-2.5 font-serif text-[1.55rem] leading-[1.12] font-semibold sm:mt-3 sm:text-[1.85rem]">
              {title}
            </h3>
            {body ? (
              <p className="mt-2.5 text-[15px] leading-relaxed text-[#2B1A18]/80 sm:mt-3 mkt-dark:text-[#f4efe8]/80">
                {body}
              </p>
            ) : null}
          </div>
          <Link
            href="#por-que-lavilet"
            className="mt-5 inline-flex items-center text-[13px] font-semibold tracking-[0.04em] text-[#72735A] transition-colors hover:text-[#C45C3E] mkt-dark:text-[#F2F2F2]"
          >
            Ver por qué La Vilet
            <ArrowRight size={15} className="ml-1.5" />
          </Link>
        </AirPiece>
      </motion.article>
    )
  }

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
        <div className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-6">
          <h3 className="font-serif text-[1.35rem] leading-[1.15] font-semibold sm:text-2xl">
            {title}
          </h3>
          {body ? (
            <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-white/82 sm:text-sm">
              {body}
            </p>
          ) : null}
        </div>
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
          <p className="text-[11px] font-medium tracking-[0.22em] text-[#8B8C74] uppercase mkt-dark:text-[#F2F2F2]/75">Recorrido 360°</p>
          <h3 className="mt-2.5 font-serif text-[1.55rem] leading-[1.12] font-semibold sm:mt-3 sm:text-[1.85rem]">
            {title}
          </h3>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[#2B1A18]/80 sm:mt-3 mkt-dark:text-[#f4efe8]/80">
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
  light = false,
}: {
  eyebrow: string
  heading: ReactNode
  stepped: boolean
  light?: boolean
}) {
  return (
    <>
      <p
        className={cn(
          'text-[11px] font-medium tracking-[0.28em] uppercase',
          light
            ? 'text-[#8B8C74] lg:text-white/75 lg:[text-shadow:0_2px_14px_rgba(20,14,10,0.55)]'
            : stepped
            ? 'text-[#8B8C74] mkt-dark:text-[#F2F2F2]/75 lg:mkt-dark:text-[#BFBFB8]'
            : 'text-white/80',
        )}
      >
        {eyebrow}
      </p>
      <h2
        className={cn(
          'mt-2 font-serif leading-[0.96] font-semibold tracking-tight text-balance',
          light
            ? 'text-[clamp(1.72rem,7.6vw,2.35rem)] leading-[1.04] text-[#2B1A18] lg:text-[3.15rem] lg:leading-[0.96] lg:!text-white lg:[text-shadow:0_3px_20px_rgba(20,14,10,0.6)]'
            : stepped
            ? 'text-[clamp(1.72rem,7.6vw,2.35rem)] leading-[1.04] text-[#2B1A18] lg:text-[3.15rem] lg:leading-[0.96] mkt-dark:text-[#f4efe8]'
            : 'max-w-xl text-[clamp(1.7rem,7.2vw,2.1rem)] text-white sm:text-5xl lg:text-[3.35rem]',
        )}
      >
        {heading}
      </h2>
    </>
  )
}

function RisingWords({ text, delay = 0 }: { text: string; delay?: number }) {
  const reduce = useReducedMotion()

  return (
    <motion.span
      className="inline"
      initial={reduce ? false : 'hidden'}
      whileInView={reduce ? undefined : 'show'}
      viewport={{ once: false, amount: 0.65 }}
      variants={{
        hidden: {},
        show: { transition: { delayChildren: delay, staggerChildren: 0.045 } },
      }}
    >
      {text.split(/\s+/).map((word, index) => (
        <motion.span
          key={`${word}-${index}`}
          className="mr-[0.22em] inline-block"
          variants={{
            hidden: { opacity: 0, y: 24, filter: 'blur(5px)' },
            show: {
              opacity: 1,
              y: 0,
              filter: 'blur(0px)',
              transition: { duration: 0.45, ease: kineticEase },
            },
          }}
        >
          {word}
        </motion.span>
      ))}
    </motion.span>
  )
}

function EditorialSequence({
  items,
  active,
  showBody,
}: {
  items: readonly { kicker: string; title: string; body: readonly string[] }[]
  active: number
  showBody: boolean
}) {
  const item = items[active] ?? items[0]
  if (!item) return null

  return (
    <div className="relative hidden min-h-[24rem] items-center overflow-hidden lg:flex lg:min-h-[min(38rem,62svh)] xl:min-h-[38rem]">
      <AnimatePresence mode="wait">
        <motion.article
          key={`${item.title}-${showBody ? 'contexto' : 'titulo'}`}
          className="w-full py-12 lg:py-16"
          initial={{ opacity: 0, y: 76, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -76, filter: 'blur(8px)' }}
          transition={{ duration: 0.65, ease: kineticEase }}
        >
          <motion.p
            className="text-[11px] font-medium tracking-[0.3em] text-white/70 uppercase [text-shadow:0_2px_12px_rgba(20,14,10,0.5)]"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.7 }}
            transition={{ duration: 0.45, ease: kineticEase }}
          >
            {String(active + 1).padStart(2, '0')} · {item.kicker}
            {showBody ? ' · CONTEXTO' : ''}
          </motion.p>
          {showBody ? (
            <div className="mt-7 max-w-xl space-y-7 sm:space-y-8">
              {item.body.map((line, index) => (
                <p
                  key={line}
                  className={cn(
                    'border-l border-white/35 pl-4 font-serif text-[clamp(1.5rem,3vw,2.45rem)] leading-[1.08] font-semibold tracking-[-0.025em] text-white [text-shadow:0_3px_20px_rgba(20,14,10,0.55)] sm:pl-5',
                    index === 1 && 'ml-8 sm:ml-12',
                    index === 2 && 'ml-16 sm:ml-24',
                  )}
                >
                  <RisingWords text={line} delay={index * 0.14} />
                </p>
              ))}
            </div>
          ) : (
            <h3 className="mt-5 max-w-xl font-serif text-[clamp(2.7rem,5.4vw,5.7rem)] leading-[0.9] font-normal tracking-[-0.045em] text-white [text-shadow:0_3px_24px_rgba(20,14,10,0.55)]">
              <RisingWords text={item.title} />
            </h3>
          )}
        </motion.article>
      </AnimatePresence>
    </div>
  )
}

function EditorialSequenceMobile({
  items,
}: {
  items: readonly { kicker: string; title: string; body: readonly string[] }[]
}) {
  return (
    <div className="space-y-4 overflow-x-clip py-8 lg:hidden">
      {items.map((item, itemIndex) => (
        <motion.article
          key={item.title}
          className="border-t border-white/25 py-14 first:border-t-0"
          initial={{ opacity: 0, x: itemIndex % 2 === 0 ? -64 : 64, y: 24 }}
          whileInView={{ opacity: 1, x: 0, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.8, ease: kineticEase }}
        >
          <p className="text-[10px] font-medium tracking-[0.28em] text-white/70 uppercase [text-shadow:0_2px_12px_rgba(20,14,10,0.55)]">
            {String(itemIndex + 1).padStart(2, '0')} · {item.kicker}
          </p>
          <h3 className="mt-4 max-w-md font-serif text-[clamp(2.5rem,13vw,4rem)] leading-[0.92] tracking-[-0.04em] text-white [text-shadow:0_3px_20px_rgba(20,14,10,0.62)]">
            {item.title}
          </h3>
          <div className="mt-8 space-y-6">
            {item.body.map((line, lineIndex) => (
              <motion.p
                key={line}
                className={cn(
                  'border-l border-white/35 pl-4 font-serif text-[1.35rem] leading-[1.15] font-semibold text-white [text-shadow:0_2px_14px_rgba(20,14,10,0.58)]',
                  lineIndex === 1 && 'ml-6',
                  lineIndex === 2 && 'ml-12',
                )}
                initial={{
                  opacity: 0,
                  x: lineIndex % 2 === 0 ? -48 : 48,
                  y: 18,
                  filter: 'blur(5px)',
                }}
                whileInView={{ opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }}
                viewport={{ once: true, amount: 0.45 }}
                transition={{ duration: 0.65, delay: lineIndex * 0.14, ease: kineticEase }}
              >
                {line}
              </motion.p>
            ))}
          </div>
        </motion.article>
      ))}
    </div>
  )
}

export function StoryBoard({
  className,
  eyebrow,
  heading,
  featured,
  promo,
  cards = [],
  sequence,
  brand,
}: {
  className?: string
  eyebrow: string
  heading: ReactNode
  featured: { src: string; alt: string; object?: string; stepped?: boolean }
  promo?: { title: string; body: string; href: string; cta: string }
  brand?: ReactNode
  cards?: {
    src: string
    alt: string
    title: string
    body?: string
    plain?: boolean
    kicker?: string
  }[]
  sequence?: readonly { kicker: string; title: string; body: readonly string[] }[]
}) {
  const clipId = `story-step-${useId().replace(/:/g, '')}`
  const stepped = Boolean(featured.stepped)
  const boardRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const wide = useWideBoard()
  const [sequenceStep, setSequenceStep] = useState(0)
  const { scrollYProgress } = useScroll({
    target: boardRef,
    offset: ['start 0.98', 'start 0.28'],
  })
  const { scrollYProgress: sequenceProgress } = useScroll({
    target: boardRef,
    offset: ['start 80px', 'end end'] as any,
  })

  useMotionValueEvent(sequenceProgress, 'change', (value) => {
    if (!sequence?.length) return
    const totalSteps = sequence.length * 2
    const next = Math.min(
      totalSteps - 1,
      Math.max(0, Math.floor(value * totalSteps)),
    )
    setSequenceStep((current) => (current === next ? current : next))
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
        'relative story-board-air',
        sequence?.length && 'lg:h-[var(--sequence-height)]',
        !sequence?.length &&
          'grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.72fr)] lg:gap-5',
        className,
      )}
      style={
        sequence?.length
          ? ({
              '--sequence-height': `${Math.max(4, sequence.length * 2) * 72}svh`,
            } as CSSProperties)
          : undefined
      }
    >
      <div
        className={cn(
          sequence?.length
            ? 'relative grid grid-rows-[auto_1fr] items-center gap-x-8 gap-y-4 py-6 lg:sticky lg:top-0 lg:min-h-svh lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.72fr)] lg:gap-x-8 lg:gap-y-5 xl:py-16'
            : 'contents',
        )}
      >
        {sequence?.length && brand ? (
          <div className="relative z-30 col-span-full flex min-h-[10rem] items-center pb-5 sm:min-h-[9rem] sm:pb-4 lg:min-h-[7rem] lg:items-end lg:pb-0">
            <div className="origin-left scale-[0.86] sm:scale-100">
              {brand}
            </div>
          </div>
        ) : null}

        <motion.article
          className={cn(
            'relative z-0 hover:z-20',
            stepped
              ? cn(
                  'min-h-[26rem] h-[min(32rem,70svh)] sm:h-auto sm:min-h-[28rem] lg:min-h-[38rem]',
                  sequence?.length &&
                    'lg:h-[min(38rem,62svh)] lg:min-h-0 xl:h-[38rem] xl:min-h-[38rem]',
                )
              : 'min-h-[22rem] sm:min-h-[28rem] lg:min-h-[38rem]',
          )}
          style={{ x: leftX, opacity: leftOpacity }}
        >
          <AirPiece
            invert
            className={cn(
              'relative h-full',
              stepped
                ? cn(
                    'min-h-[26rem] h-[min(32rem,70svh)] sm:h-auto sm:min-h-[28rem] lg:h-full lg:min-h-[38rem]',
                    sequence?.length &&
                      'lg:h-[min(38rem,62svh)] lg:min-h-0 xl:h-[38rem] xl:min-h-[38rem]',
                  )
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
              <StoryHeading
                eyebrow={eyebrow}
                heading={heading}
                stepped={stepped}
                light={Boolean(sequence?.length)}
              />
            </div>
          </AirPiece>
        </motion.article>

        {sequence?.length ? (
          <>
            <EditorialSequence
              items={sequence}
              active={Math.floor(sequenceStep / 2)}
              showBody={sequenceStep % 2 === 1}
            />
            <EditorialSequenceMobile items={sequence} />
          </>
        ) : (
          <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2 lg:flex lg:gap-5">
            {promo ? <PromoCard {...promo} x={promoX} opacity={promoOpacity} /> : null}
            {cards.map((card, index) => (
              <StoryCard
                key={card.title}
                src={card.src}
                alt={card.alt}
                title={card.title}
                body={card.body}
                plain={card.plain}
                kicker={card.kicker}
                x={cardMotion[index]?.x ?? card0X}
                opacity={cardMotion[index]?.opacity ?? card0Opacity}
                delay={0.45 + index * 0.55}
                invert={index % 2 === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function LaviletStory() {
  const docked = useLockupDocked()

  return (
    <section id="nosotros" className="relative z-20 scroll-mt-28 bg-[#e8dcc8] pb-16 lg:pb-24 mkt-dark:bg-[#cfc3b3]">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={INTERIOR.wall}
          alt=""
          className="h-full w-full object-cover object-[left_center]"
        />
        <div className="absolute inset-0 bg-[#f3ece4]/28 backdrop-blur-[8px] mkt-dark:bg-[#8c8478]/24" />
      </div>
      <div className="relative z-10 mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
        <StoryBoard
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
          brand={docked ? <LaviletLockup variant="story" /> : null}
          sequence={[
            {
              kicker: 'Recorrido 360°',
              title: 'Explora antes de elegir',
              body: [
                'Entra a las suites y departamentos.',
                'Recorre cada planta.',
                'Compara distribuciones y acabados antes de agendar una visita.',
              ],
            },
            {
              kicker: 'El proyecto',
              title: 'Conoce el proyecto completo',
              body: [
                'Vivienda y comercio se integran sin perder privacidad.',
                'Conoce los espacios que ofrece La Vilet.',
                'Descubre cómo Puertas del Sol y el Tomebamba forman parte de la vida diaria.',
              ],
            },
          ]}
        />

        <AboutEditorial />
      </div>
    </section>
  )
}

export { LaviletPlaceBoard } from './PlaceGallery'
