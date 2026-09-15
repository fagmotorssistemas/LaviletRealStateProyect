'use client'

import { useRef, type MouseEvent, type ReactNode } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'

const ease = [0.22, 1, 0.36, 1] as const

const AMENITIES = [
  { id: 'comunales', label: 'Áreas comunales', icon: IconPeople },
  { id: 'piscina', label: 'Piscina / Sauna', icon: IconPool },
  { id: 'residencial', label: 'Zona residencial', icon: IconCity },
  { id: 'gimnasio', label: 'Gimnasio', icon: IconDumbbell },
  { id: 'terrazas', label: 'Terrazas', icon: IconTerrace },
  { id: 'parques', label: 'Parques', icon: IconPark },
] as const

const FINDS = [
  'Piscina amplia',
  'Gimnasio equipado',
  'Jardines y descanso',
  'Vistas a la ciudad',
]

function IconPeople() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className="h-14 w-14 sm:h-16 sm:w-16">
      <circle cx="22" cy="18" r="7" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="42" cy="18" r="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 48c1.5-9 7-14 14-14s12.5 5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M28 48c1.5-9 7-14 14-14s12.5 5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconPool() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className="h-14 w-14 sm:h-16 sm:w-16">
      <path d="M14 18v22" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M14 18h18v8H22" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M8 46c4 4 8 4 12 0s8-4 12 0 8 4 12 0 8-4 12 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M8 54c4 4 8 4 12 0s8-4 12 0 8 4 12 0 8-4 12 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconCity() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className="h-14 w-14 sm:h-16 sm:w-16">
      <path d="M10 54V28h16v26" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M26 54V18h16v36" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M42 54V24h12v30" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M16 34v4M16 42v4M34 26v4M34 34v4M48 32v4M48 40v4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function IconDumbbell() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className="h-14 w-14 sm:h-16 sm:w-16">
      <path d="M18 22v20M22 18v28M42 18v28M46 22v20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M22 32h20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconTerrace() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className="h-14 w-14 sm:h-16 sm:w-16">
      <path d="M14 50V22h36v28" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M14 50h36" stroke="currentColor" strokeWidth="1.4" />
      <path d="M22 22v28M42 28l-12 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconPark() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className="h-14 w-14 sm:h-16 sm:w-16">
      <path d="M8 46h28" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M12 46v-8h20v8M16 38v-6h12v6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M46 52V28" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M46 30c-8 0-12 8-12 14 4-2 8-2 12 0 4-2 8-2 12 0 0-6-4-14-12-14Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function AmenityCard({
  label,
  icon,
  delay,
}: {
  label: string
  icon: () => ReactNode
  delay: number
}) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLButtonElement>(null)
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const x = useSpring(mx, { stiffness: 180, damping: 18, mass: 0.4 })
  const y = useSpring(my, { stiffness: 180, damping: 18, mass: 0.4 })
  const rotateX = useTransform(y, [-24, 24], [10, -10])
  const rotateY = useTransform(x, [-24, 24], [-10, 10])
  const Icon = icon

  function onMove(event: MouseEvent<HTMLButtonElement>) {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    mx.set(event.clientX - box.left - box.width / 2)
    my.set(event.clientY - box.top - box.height / 2)
  }

  function onLeave() {
    mx.set(0)
    my.set(0)
  }

  return (
    <motion.button
      ref={ref}
      type="button"
      onMouseMove={reduce ? undefined : onMove}
      onMouseLeave={onLeave}
      style={reduce ? undefined : { x, y, rotateX, rotateY, transformPerspective: 700 }}
      className="group relative flex aspect-square flex-col items-center justify-center rounded-[1.4rem] bg-[#f2f2f2]/70 ring-1 ring-[#72735A]/12 transition-colors hover:bg-[#f2f2f2]/95 hover:ring-[#72735A]/22 mkt-dark:bg-white/8 mkt-dark:ring-white/15 mkt-dark:hover:bg-white/14 mkt-dark:hover:ring-white/30"
      initial={reduce ? false : { opacity: 0, y: 28, scale: 0.92 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.7, delay, ease }}
      whileHover={reduce ? undefined : { scale: 1.03 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
    >
      <motion.div
        className="text-[#72735A] mkt-dark:text-[#F2F2F2]"
        animate={
          reduce
            ? undefined
            : { y: [0, -7, 0], rotate: [-2.5, 2.5, -2.5] }
        }
        transition={{ duration: 5.4 + delay * 4, repeat: Infinity, ease: 'easeInOut', delay }}
      >
        <Icon />
      </motion.div>
      <span className="mt-3 max-w-[7.5rem] text-center text-[11px] font-medium leading-tight tracking-[0.14em] text-[#72735A]/80 uppercase sm:text-xs mkt-dark:text-[#F2F2F2]/85">
        {label}
      </span>
    </motion.button>
  )
}

export function ExperienceLiving() {
  const reduce = useReducedMotion()
  const loop = [...AMENITIES, ...AMENITIES, ...AMENITIES]

  return (
    <section
      className="relative z-20 overflow-hidden py-20 text-[#72735A] lg:py-28 mkt-dark:text-[#F2F2F2]"
      aria-labelledby="experiencia-title"
    >
      <div className="mx-auto grid max-w-[1400px] items-start gap-14 px-5 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)] lg:gap-16 lg:px-12">
        <div>
          <motion.p
            className="text-[11px] font-medium tracking-[0.32em] text-[#8B8C74] uppercase mkt-dark:text-[#BFBFB8]"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, ease }}
          >
            Vivir en La Vilet
          </motion.p>
          <motion.h2
            id="experiencia-title"
            className="mt-4 font-serif text-[clamp(3.2rem,10vw,6.75rem)] leading-[0.86] font-normal tracking-[-0.045em]"
            initial={reduce ? false : { opacity: 0, y: 36, filter: 'blur(8px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.85, ease }}
          >
            experiencia
          </motion.h2>

          <motion.p
            className="mt-8 max-w-lg text-[15px] leading-relaxed text-[#72735A]/80 sm:text-base mkt-dark:text-[#F2F2F2]/82"
            initial={reduce ? false : { opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.65, delay: 0.1, ease }}
          >
            En su última planta alta, La Vilet marca diferencia con áreas comunales pensadas para
            desconectarse y encontrarse.
          </motion.p>

          <p className="mt-7 text-[11px] font-medium tracking-[0.22em] text-[#8B8C74] uppercase mkt-dark:text-[#BFBFB8]">
            Podemos encontrar
          </p>
          <ul className="mt-4 space-y-2.5">
            {FINDS.map((item, index) => (
              <motion.li
                key={item}
                className="flex items-center gap-3 text-[15px] text-[#72735A]/88 mkt-dark:text-[#F2F2F2]/88"
                initial={reduce ? false : { opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.08 + index * 0.08, ease }}
              >
                <motion.span
                  className="inline-block h-px w-5 bg-[#BDA27E]"
                  animate={reduce ? undefined : { width: [16, 28, 16] }}
                  transition={{ duration: 2.8 + index * 0.4, repeat: Infinity, ease: 'easeInOut' }}
                />
                {item}
              </motion.li>
            ))}
          </ul>

          <motion.p
            className="mt-8 max-w-lg text-[15px] leading-relaxed text-[#72735A]/75 sm:text-base mkt-dark:text-[#F2F2F2]/75"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.65, delay: 0.16, ease }}
          >
            Equilibrio entre lo urbano y lo natural: más que un proyecto, una forma de habitar con
            inversión, diseño y calidad.
          </motion.p>
        </div>

        <div
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:gap-5"
          style={{ perspective: 900 }}
        >
          {AMENITIES.map((item, index) => (
            <AmenityCard
              key={item.id}
              label={item.label}
              icon={item.icon}
              delay={0.08 + index * 0.07}
            />
          ))}
        </div>
      </div>

      <div className="mt-16 overflow-hidden border-y border-[#72735A]/12 py-4 lg:mt-20 mkt-dark:border-white/10">
        <motion.div
          className="flex w-max gap-10 whitespace-nowrap"
          animate={reduce ? undefined : { x: ['0%', '-33.333%'] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
        >
          {loop.map((item, index) => (
            <span
              key={`${item.id}-${index}`}
              className="font-serif text-2xl tracking-[-0.03em] text-[#72735A]/28 sm:text-3xl mkt-dark:text-[#F2F2F2]/35"
            >
              {item.label}
              <span className="mx-4 text-[#BDA27E]/50">·</span>
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
