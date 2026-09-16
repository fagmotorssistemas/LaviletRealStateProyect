'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

const ease = [0.22, 1, 0.36, 1] as const

const PATCHES = [
  {
    id: 'aislamiento',
    n: '01',
    word: 'aislamiento',
    label: 'Acústico y térmico',
    bg: '#72735A',
    className:
      'min-h-[19rem] -rotate-2 lg:absolute lg:top-[4%] lg:left-0 lg:h-[66%] lg:w-[41%] lg:-rotate-[2.4deg]',
  },
  {
    id: 'parqueo',
    n: '02',
    word: 'parqueo',
    label: 'Dos niveles',
    bg: '#C45C3E',
    className:
      'min-h-[12rem] rotate-2 -mt-8 lg:absolute lg:top-[2%] lg:left-[32%] lg:mt-0 lg:h-[30%] lg:w-[30%] lg:rotate-[3deg]',
  },
  {
    id: 'title',
    n: '',
    word: 'equipamiento',
    label: '',
    bg: '#F2F2F2',
    title: true,
    className:
      'min-h-[14rem] rotate-1 -mt-6 lg:absolute lg:top-0 lg:right-0 lg:mt-0 lg:h-[38%] lg:w-[46%] lg:rotate-[1.2deg]',
  },
  {
    id: 'incendio',
    n: '03',
    word: 'incendio',
    label: 'Sistema contraincendios',
    bg: '#BDA27E',
    className:
      'min-h-[15rem] -mt-10 rounded-[46%] lg:absolute lg:top-[36%] lg:left-[34%] lg:mt-0 lg:h-[40%] lg:w-[31%] lg:-rotate-1',
  },
  {
    id: 'gas',
    n: '04',
    word: 'gas',
    label: 'Agua caliente centralizada',
    bg: '#8B8C74',
    className:
      'min-h-[12rem] rotate-2 -mt-8 lg:absolute lg:top-[42%] lg:right-[2%] lg:mt-0 lg:h-[28%] lg:w-[34%] lg:rotate-[2deg]',
  },
  {
    id: 'generador',
    n: '05',
    word: 'energía',
    label: 'Generador eléctrico',
    bg: '#C45C3E',
    className:
      'min-h-[13rem] -rotate-3 -mt-12 rounded-[46%] lg:absolute lg:right-[6%] lg:bottom-[16%] lg:z-10 lg:mt-0 lg:h-[30%] lg:w-[23%] lg:-rotate-[6deg]',
  },
  {
    id: 'sismo',
    n: '06',
    word: 'sismo',
    label: 'Estructura sismoresistente',
    bg: '#BDA27E',
    className:
      'min-h-[12rem] -mt-7 lg:absolute lg:bottom-0 lg:left-[1%] lg:mt-0 lg:h-[26%] lg:w-[33%] lg:rotate-[1.5deg]',
  },
  {
    id: 'seguridad',
    n: '07',
    word: 'seguridad',
    label: 'Accesos y control',
    bg: '#8B8C74',
    className:
      'min-h-[12rem] rotate-2 -mt-9 lg:absolute lg:bottom-[1%] lg:left-[32%] lg:mt-0 lg:h-[24%] lg:w-[30%] lg:rotate-[2.5deg]',
  },
  {
    id: 'ascensores',
    n: '08',
    word: 'ascensores',
    label: 'Dos, de última generación',
    bg: '#72735A',
    className:
      'min-h-[12rem] -rotate-1 -mt-8 lg:absolute lg:right-0 lg:bottom-0 lg:mt-0 lg:h-[24%] lg:w-[34%] lg:-rotate-[1.8deg]',
  },
] as const

export function Equipamiento() {
  const reduce = useReducedMotion()

  return (
    <section
      className="relative z-20 overflow-x-clip bg-[#EDECE6] py-16 text-[#72735A] mkt-dark:bg-[#1f201a] sm:py-24"
      aria-labelledby="equipamiento-title"
    >
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <p className="text-[11px] font-medium tracking-[0.34em] text-[#8B8C74] uppercase mkt-dark:text-[#BFBFB8]">
          el edificio
        </p>
        <h2
          id="equipamiento-title"
          className="mt-5 max-w-4xl font-serif text-[clamp(2.8rem,8vw,6.4rem)] leading-[0.84] font-normal tracking-[-0.045em]"
        >
          equipamiento
        </h2>
        <p className="mt-5 max-w-md font-serif text-[clamp(1.1rem,2vw,1.4rem)] italic leading-snug text-[#72735A]/75 mkt-dark:text-[#F2F2F2]/70">
          Confianza, confort y seguridad.
        </p>
      </div>

      <div className="relative mx-auto mt-10 max-w-[1400px] px-5 sm:mt-14 sm:px-8">
        <div className="relative lg:h-[min(92vh,860px)]">
          {PATCHES.map((patch, index) => {
            const isTitle = 'title' in patch && patch.title
            return (
              <motion.article
                key={patch.id}
                className={cn(
                  'relative z-[1] overflow-hidden rounded-[2rem] p-6 sm:p-8',
                  isTitle ? 'text-[#72735A] ring-1 ring-[#72735A]/25' : 'text-[#F2F2F2]',
                  patch.className,
                )}
                style={{ backgroundColor: patch.bg }}
                initial={reduce ? false : { opacity: 0, y: 36, rotate: 0 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.75, delay: 0.03 * index, ease }}
                whileHover={
                  reduce
                    ? undefined
                    : { scale: 1.045, rotate: 0, zIndex: 30, transition: { duration: 0.35 } }
                }
              >
                {isTitle ? (
                  <div className="relative flex h-full min-h-[12rem] flex-col justify-end lg:min-h-0">
                    <p className="text-[10px] font-medium tracking-[0.34em] text-[#BDA27E] uppercase">
                      La Vilēt
                    </p>
                    <p className="relative mt-4 font-serif text-[clamp(2.4rem,5vw,4.2rem)] leading-[0.8] tracking-[-0.045em]">
                      equipamiento
                    </p>
                    <p className="relative mt-3 font-serif text-[1.05rem] italic text-[#72735A]/70">
                      confianza, confort y seguridad
                    </p>
                  </div>
                ) : (
                  <div className="relative flex h-full min-h-[10rem] flex-col justify-between lg:min-h-0">
                    <span className="text-[10px] font-medium tracking-[0.3em] opacity-55">
                      {patch.n}
                    </span>
                    <div className="relative mt-6">
                      <p className="relative font-serif text-[clamp(2rem,4.4vw,4.2rem)] leading-[0.88] tracking-[-0.05em]">
                        {patch.word}
                      </p>
                      <p className="relative mt-3 text-[13px] leading-snug sm:text-sm">
                        {patch.label}
                      </p>
                    </div>
                  </div>
                )}
              </motion.article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
