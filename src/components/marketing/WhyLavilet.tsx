'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { SITE } from '@/lib/marketing/site'

const ease = [0.22, 1, 0.36, 1] as const

const REASONS = [
  {
    n: '01',
    title: 'Dos usos, sin mezclar rutinas',
    body: 'El comercio ocupa la planta baja y la primera planta alta; las residencias continúan arriba. Sus accesos independientes mantienen la actividad cerca y la privacidad intacta.',
  },
  {
    n: '02',
    title: 'Opciones para distintas etapas',
    body: 'Suites y departamentos de 2 y 3 dormitorios permiten elegir según el momento de vida, sin convertir todas las viviendas en una misma respuesta.',
  },
  {
    n: '03',
    title: 'Una ubicación que se vive',
    body: 'Puertas del Sol, en Ricardo Darquea Granda y Elena Landívar. El Tomebamba, el parque lineal y las conexiones de la ciudad forman parte del recorrido diario.',
  },
] as const

export function WhyLavilet({
  part = 'all',
}: {
  part?: 'all' | 'overview' | 'reasons'
}) {
  const reduce = useReducedMotion()

  return (
    <>
      {part !== 'reasons' ? (
        <section
        id="por-que-lavilet"
        className="relative z-20 overflow-hidden border-y border-[#72735A]/12 bg-[#f4f1ea] py-16 text-[#2B1A18] sm:py-20 lg:py-24"
        aria-labelledby="por-que-lavilet-title"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50 mix-blend-multiply"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent 0 3px, rgba(43,26,24,0.026) 3px 4px), repeating-linear-gradient(90deg, transparent 0 5px, rgba(114,115,90,0.032) 5px 6px)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[44%] bg-[#f4f1ea]/18"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 right-[-8rem] h-[26rem] w-[26rem] rounded-full border border-[#C45C3E]/12"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 right-[-2rem] h-[16rem] w-[16rem] rounded-full border border-[#C45C3E]/10"
        />

        <div className="relative mx-auto grid w-full max-w-[1400px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(30rem,1.1fr)] lg:gap-20 lg:px-12">
          <motion.div
            initial={reduce ? false : { opacity: 0, x: -56 }}
            whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.45 }}
            transition={{ duration: 0.85, ease }}
          >
            <p className="text-[11px] font-medium tracking-[0.34em] text-[#8B8C74] uppercase">
              Por qué La Vilet
            </p>
            <h2
              id="por-que-lavilet-title"
              className="mt-4 max-w-3xl font-serif text-[clamp(2.7rem,5.4vw,5rem)] leading-[0.88] font-normal tracking-[-0.045em] text-[#72735A]"
            >
              La diferencia está en cómo todo encaja.
            </h2>
            <motion.p
              className="mt-8 max-w-xl border-l-2 border-[#C45C3E]/60 pl-5 text-[15px] leading-relaxed text-[#2B1A18]/72 sm:text-[18px]"
              initial={reduce ? false : { opacity: 0, y: 24 }}
              whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: 0.7, delay: 0.2, ease }}
            >
              La Vilet no separa vivienda, ciudad y vida cotidiana. Los reúne con una distribución
              clara, recorridos independientes y herramientas reales para conocer cada opción
              antes de decidir.
            </motion.p>
          </motion.div>

          <motion.article
            className="relative overflow-hidden rounded-[2rem] bg-[#72735A] px-7 py-10 text-[#f4f1ea] shadow-[0_30px_70px_rgba(43,26,24,0.18)] sm:px-10 sm:py-12 lg:px-12 lg:py-14"
            initial={reduce ? false : { opacity: 0, x: 64, scale: 0.94 }}
            whileInView={reduce ? undefined : { opacity: 1, x: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.9, ease }}
          >
            <p className="text-[10px] font-medium tracking-[0.3em] text-[#f4f1ea]/60 uppercase">
              El proyecto en cifras
            </p>
            <div className="mt-10 grid grid-cols-2 gap-5 sm:mt-12">
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 60 }}
                whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.7 }}
                transition={{ duration: 0.7, delay: 0.25, ease }}
              >
                <p className="font-serif text-[clamp(4.5rem,10vw,8rem)] leading-[0.72] tracking-[-0.06em]">
                  49
                </p>
                <p className="mt-5 text-[11px] font-medium tracking-[0.22em] text-[#f4f1ea]/70 uppercase">
                  viviendas
                </p>
              </motion.div>
              <motion.div
                className="border-l border-[#f4f1ea]/22 pl-5 sm:pl-8"
                initial={reduce ? false : { opacity: 0, y: 60 }}
                whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.7 }}
                transition={{ duration: 0.7, delay: 0.4, ease }}
              >
                <p className="font-serif text-[clamp(4.5rem,10vw,8rem)] leading-[0.72] tracking-[-0.06em] text-[#f4f1ea] [text-shadow:0_3px_20px_rgba(20,14,10,0.28)]">
                  16
                </p>
                <p className="mt-5 text-[11px] font-medium tracking-[0.22em] text-[#f4f1ea]/70 uppercase">
                  locales
                </p>
              </motion.div>
            </div>
            <p className="mt-10 max-w-lg border-t border-[#f4f1ea]/20 pt-6 text-sm leading-relaxed text-[#f4f1ea]/78 sm:mt-12 sm:text-[15px]">
              Suites, departamentos de 2 y 3 dormitorios y espacios comerciales. Las tipologías
              completas se presentan más adelante para compararlas sin repetir información.
            </p>
          </motion.article>
        </div>
        </section>
      ) : null}

      {part !== 'overview' ? (
        <section
        className="relative z-20 overflow-hidden bg-[#f4f1ea] py-16 text-[#2B1A18] sm:py-20 lg:py-24"
        aria-labelledby="razones-lavilet"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-55 mix-blend-multiply"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent 0 4px, rgba(114,115,90,0.035) 4px 5px), repeating-linear-gradient(90deg, transparent 0 5px, rgba(114,115,90,0.028) 5px 6px)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 left-[8%] hidden w-px bg-[#72735A]/12 lg:block"
        />
        <div className="relative mx-auto w-full max-w-[1400px] px-5 sm:px-8 lg:px-12">
          <motion.div
            className="grid gap-5 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] lg:items-end lg:gap-20"
            initial={reduce ? false : { opacity: 0, x: -48 }}
            whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.45 }}
            transition={{ duration: 0.8, ease }}
          >
            <p className="text-[11px] font-medium tracking-[0.34em] text-[#C45C3E] uppercase">
              Lo que cambia la experiencia
            </p>
            <h2
              id="razones-lavilet"
              className="max-w-3xl font-serif text-[clamp(2.5rem,4.5vw,4.5rem)] leading-[0.9] font-normal tracking-[-0.04em] text-[#72735A]"
            >
              Tres razones para mirar más de cerca.
            </h2>
          </motion.div>

          <div className="mt-12 grid border-y border-[#72735A]/16 lg:grid-cols-3 lg:divide-x lg:divide-[#72735A]/16">
            {REASONS.map((reason, index) => (
              <motion.article
                key={reason.n}
                className="border-b border-[#72735A]/16 py-8 last:border-b-0 lg:border-b-0 lg:px-8 lg:first:pl-0 lg:last:pr-0"
                initial={reduce ? false : { opacity: 0, y: 36 }}
                whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.55 }}
                transition={{ duration: 0.7, delay: index * 0.1, ease }}
              >
                <p className="text-[11px] font-semibold tracking-[0.2em] text-[#C45C3E]">
                  {reason.n}
                </p>
                <h3 className="mt-4 font-serif text-[clamp(1.8rem,2.4vw,2.5rem)] leading-[1.05] tracking-[-0.03em] text-[#72735A]">
                  {reason.title}
                </h3>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#2B1A18]/68 sm:text-[16px]">
                  {reason.body}
                </p>
              </motion.article>
            ))}
          </div>

          <motion.div
            className="mt-10 flex flex-col gap-6 border-t border-[#72735A]/16 pt-8 sm:flex-row sm:items-center sm:justify-between"
            initial={reduce ? false : { opacity: 0, y: 44 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.75, ease }}
          >
            <div>
              <p className="text-[10px] font-medium tracking-[0.28em] text-[#8B8C74] uppercase">
                Acompañamiento para comprar
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#2B1A18]/68 sm:text-[15px]">
                Puedes consultar alternativas de financiamiento con Banco Pichincha o Cooperativa
                JEP. La aprobación y las condiciones dependen de la evaluación de cada entidad.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Link
                href="/contacto"
                className="inline-flex h-11 items-center rounded-full bg-[#72735A] px-5 text-[11px] font-semibold tracking-[0.14em] text-[#f4f1ea] uppercase transition-colors hover:bg-[#5f6049]"
              >
                Agendar visita
                <ArrowRight size={14} className="ml-2" />
              </Link>
              <a
                href={SITE.location.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center rounded-full px-5 text-[11px] font-semibold tracking-[0.14em] text-[#72735A] uppercase ring-1 ring-[#72735A]/25 transition-colors hover:bg-[#72735A]/6"
              >
                Ver ubicación
              </a>
            </div>
          </motion.div>
        </div>
        </section>
      ) : null}
    </>
  )
}
