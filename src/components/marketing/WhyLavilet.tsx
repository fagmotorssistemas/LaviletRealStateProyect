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
    title: 'Decidir con evidencia',
    body: 'El recorrido 360° permite explorar el edificio planta por planta, entrar a las tipologías y comparar espacios antes de agendar una visita.',
  },
  {
    n: '03',
    title: 'Una ubicación que se vive',
    body: 'Puertas del Sol, en Ricardo Darquea Granda y Elena Landívar. El Tomebamba, el parque lineal y las conexiones de la ciudad forman parte del recorrido diario.',
  },
] as const

export function WhyLavilet() {
  const reduce = useReducedMotion()

  return (
    <>
      <section
        id="por-que-lavilet"
        className="relative z-20 flex min-h-svh items-center overflow-hidden border-y border-[#72735A]/12 bg-[#efece4] py-20 text-[#2B1A18] sm:py-24 lg:py-28"
        aria-labelledby="por-que-lavilet-title"
      >
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
              className="mt-4 max-w-3xl font-serif text-[clamp(2.7rem,6.2vw,5.8rem)] leading-[0.88] font-normal tracking-[-0.045em] text-[#72735A]"
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
            <div className="mt-12 grid grid-cols-2 gap-5 sm:mt-16">
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
            <p className="mt-12 max-w-lg border-t border-[#f4f1ea]/20 pt-6 text-sm leading-relaxed text-[#f4f1ea]/78 sm:mt-16 sm:text-[15px]">
              36 suites, 7 departamentos de 2 dormitorios y 6 de 3 dormitorios. El área
              residencial comienza desde 49,86 m²; las opciones incluyen bodega y parqueadero
              según su tipología.
            </p>
          </motion.article>
        </div>
      </section>

      <section
        className="relative z-20 flex min-h-svh items-center overflow-hidden bg-[#f4f1ea] py-20 text-[#2B1A18] sm:py-24 lg:py-28"
        aria-labelledby="razones-lavilet"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 left-[8%] hidden w-px bg-[#72735A]/12 lg:block"
        />
        <div className="relative mx-auto grid w-full max-w-[1400px] gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] lg:gap-20 lg:px-12">
          <motion.div
            className="lg:sticky lg:top-32 lg:self-start"
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
              className="mt-4 max-w-lg font-serif text-[clamp(2.5rem,4.8vw,4.8rem)] leading-[0.9] font-normal tracking-[-0.04em] text-[#72735A]"
            >
              Tres razones para mirar más de cerca.
            </h2>
          </motion.div>

          <div className="divide-y divide-[#72735A]/16 border-y border-[#72735A]/16">
            {REASONS.map((reason, index) => (
              <motion.article
                key={reason.n}
                className="grid gap-4 py-9 sm:grid-cols-[4rem_1fr] sm:gap-7 sm:py-11"
                initial={reduce ? false : { opacity: 0, x: index % 2 === 0 ? 58 : -58 }}
                whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.55 }}
                transition={{ duration: 0.7, delay: index * 0.1, ease }}
              >
                <p className="text-[11px] font-semibold tracking-[0.2em] text-[#C45C3E]">
                  {reason.n}
                </p>
                <div>
                  <h3 className="font-serif text-[clamp(1.8rem,3vw,2.8rem)] leading-[1.05] tracking-[-0.03em] text-[#72735A]">
                    {reason.title}
                  </h3>
                  <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#2B1A18]/68 sm:text-[17px]">
                    {reason.body}
                  </p>
                </div>
              </motion.article>
            ))}
          </div>

          <motion.div
            className="flex flex-col gap-6 border-t border-[#72735A]/16 pt-8 sm:flex-row sm:items-center sm:justify-between lg:col-start-2"
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
                href="/tour"
                className="inline-flex h-11 items-center rounded-full bg-[#72735A] px-5 text-[11px] font-semibold tracking-[0.14em] text-[#f4f1ea] uppercase transition-colors hover:bg-[#5f6049]"
              >
                Recorrer en 360°
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
    </>
  )
}
