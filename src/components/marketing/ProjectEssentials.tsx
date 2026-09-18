'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

const ease = [0.22, 1, 0.36, 1] as const

const PROJECT_DETAILS = [
  {
    number: '01',
    kicker: 'Respaldo y ejecución',
    title: 'Quién lo hace posible',
    fields: [
      {
        label: 'Responsable de la construcción',
        value:
          'Aquí debe ir la constructora, el promotor y el equipo profesional responsable de La Vilet.',
      },
      {
        label: 'Estado y avance de obra',
        value:
          'Aquí debe ir la etapa actual, el porcentaje de avance y la fecha de la última actualización.',
      },
      {
        label: 'Entrega estimada',
        value:
          'Aquí debe ir la fecha estimada de entrega y el próximo hito importante de la construcción.',
      },
    ],
  },
  {
    number: '02',
    kicker: 'Construcción',
    title: 'Cómo está pensado el edificio',
    fields: [
      {
        label: 'Materiales y acabados',
        value:
          'Aquí deben ir los materiales principales, acabados interiores, marcas y opciones de personalización.',
      },
      {
        label: 'Aislamiento acústico',
        value:
          'Aquí debe explicarse cómo se separa acústicamente el comercio de las viviendas y qué solución técnica se utiliza.',
      },
      {
        label: 'Estructura y sistemas',
        value:
          'Aquí deben ir ascensores, sistema estructural, instalaciones eléctricas, agua, respaldo energético y protección contra incendios.',
      },
    ],
  },
  {
    number: '03',
    kicker: 'Protección y respaldo',
    title: 'Qué cuida tu inversión',
    fields: [
      {
        label: 'Seguridad del edificio',
        value:
          'Aquí deben ir controles de acceso, videovigilancia, ingreso vehicular y protocolos de seguridad.',
      },
      {
        label: 'Garantías y postventa',
        value:
          'Aquí deben explicarse las garantías de construcción, acabados y el acompañamiento después de la entrega.',
      },
    ],
  },
  {
    number: '04',
    kicker: 'Decisión de compra',
    title: 'La información antes de elegir',
    fields: [
      {
        label: 'Disponibilidad y valores',
        value:
          'Aquí debe mostrarse la disponibilidad vigente, rangos de precio y qué incluye cada tipología.',
      },
      {
        label: 'Alícuota y costos',
        value:
          'Aquí debe ir la alícuota estimada, qué servicios cubre y cualquier costo recurrente relevante.',
      },
    ],
  },
] as const

export function ProjectEssentials() {
  const reduce = useReducedMotion()
  const [openGroup, setOpenGroup] = useState(0)

  return (
    <section
      id="informacion-proyecto"
      className="relative z-20 overflow-hidden border-y border-[#72735A]/15 bg-[#f4f1ea] text-[#2B1A18]"
      aria-labelledby="informacion-proyecto-title"
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
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[59%] border-l border-[#72735A]/10 bg-[#f4f1ea]/42 lg:block"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full border border-[#C45C3E]/14"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -left-20 h-52 w-52 rounded-full border border-[#C45C3E]/12"
      />

      <div className="relative mx-auto grid w-full max-w-[1400px] gap-12 px-5 py-14 sm:px-8 sm:py-16 lg:grid-cols-[minmax(19rem,0.75fr)_minmax(0,1.25fr)] lg:gap-20 lg:px-12 lg:py-20">
        <motion.div
          className="lg:sticky lg:top-28 lg:self-start"
          initial={reduce ? false : { opacity: 0, x: -48 }}
          whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.8, ease }}
        >
          <p className="text-[11px] font-medium tracking-[0.34em] text-[#C45C3E] uppercase">
            Información del proyecto
          </p>
          <h2
            id="informacion-proyecto-title"
            className="mt-4 max-w-xl font-serif text-[clamp(2.8rem,5vw,5rem)] leading-[0.9] font-normal tracking-[-0.045em] text-[#72735A]"
          >
            El edificio,
            <br />
            sin rodeos.
          </h2>
          <p className="mt-7 max-w-md border-l-2 border-[#C45C3E]/55 pl-5 text-[15px] leading-relaxed text-[#2B1A18]/72 sm:text-[17px]">
            Aquí reuniremos la información verificable que necesitas conocer antes de elegir:
            quién construye, cómo avanza y qué respalda cada decisión.
          </p>

          <div className="mt-8 inline-flex rounded-full border border-[#C45C3E]/30 px-4 py-2 text-[10px] font-semibold tracking-[0.2em] text-[#C45C3E] uppercase">
            Datos por confirmar
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/contacto"
              className="inline-flex h-11 items-center rounded-full bg-[#72735A] px-5 text-[11px] font-semibold tracking-[0.14em] text-[#f4f1ea] uppercase transition-colors hover:bg-[#5f6049]"
            >
              Agendar visita
            </Link>
          </div>
        </motion.div>

        <div className="border-b border-[#72735A]/18">
          {PROJECT_DETAILS.map((group, index) => (
            <motion.article
              key={group.number}
              className="border-t border-[#72735A]/18"
              initial={
                reduce
                  ? false
                  : { opacity: 0, x: index % 2 === 0 ? 38 : -38, y: 12 }
              }
              whileInView={reduce ? undefined : { opacity: 1, x: 0, y: 0 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 0.72, delay: index * 0.06, ease }}
            >
              <button
                type="button"
                className="grid w-full grid-cols-[2.75rem_1fr_auto] items-center gap-3 py-6 text-left sm:grid-cols-[4.25rem_1fr_auto] sm:gap-5 sm:py-7"
                aria-expanded={openGroup === index}
                aria-controls={`project-detail-${group.number}`}
                onClick={() => setOpenGroup((current) => (current === index ? -1 : index))}
              >
                <span className="text-[11px] font-semibold tracking-[0.2em] text-[#C45C3E]">
                  {group.number}
                </span>
                <span>
                  <span className="block text-[10px] font-medium tracking-[0.25em] text-[#8B8C74] uppercase">
                    {group.kicker}
                  </span>
                  <span className="mt-1 block font-serif text-[clamp(1.65rem,3vw,2.55rem)] leading-[1] tracking-[-0.035em] text-[#72735A]">
                    {group.title}
                  </span>
                </span>
                <motion.span
                  animate={{ rotate: openGroup === index ? 180 : 0 }}
                  transition={{ duration: 0.3, ease }}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-[#72735A]/20 text-[#72735A]"
                >
                  <ChevronDown size={18} />
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {openGroup === index ? (
                  <motion.div
                    id={`project-detail-${group.number}`}
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduce ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.42, ease }}
                    className="overflow-hidden"
                  >
                    <div className="grid gap-x-8 gap-y-6 pb-8 pl-[2.75rem] sm:grid-cols-2 sm:pb-9 sm:pl-[5.5rem]">
                      {group.fields.map((field, fieldIndex) => (
                        <motion.div
                          key={field.label}
                          className={
                            group.fields.length === 3 && fieldIndex === 2
                              ? 'sm:col-span-2'
                              : undefined
                          }
                          initial={reduce ? false : { opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.45,
                            delay: fieldIndex * 0.07,
                            ease,
                          }}
                        >
                          <p className="text-[11px] font-semibold tracking-[0.12em] text-[#2B1A18]/78 uppercase">
                            {field.label}
                          </p>
                          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[#2B1A18]/60 sm:text-[15px]">
                            {field.value}
                          </p>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}
