'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { PILLARS, PROCESS_TOUCHPOINTS, STEPS } from '@/lib/marketing/site'

const ease = [0.22, 1, 0.36, 1] as const

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, delay: i * 0.1, ease },
  }),
}

export function ProcesoView() {
  return (
    <div className="relative z-20 overflow-hidden bg-lv-bg mkt-dark:bg-[#0a0a0a]">
      <div
        aria-hidden
        className="pointer-events-none absolute top-24 left-0 h-72 w-72 rounded-full border border-lv-line-faint"
      />

      <section className="pt-24 pb-14 sm:pt-28 lg:pb-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            className="grid items-end gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14"
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.12 } } }}
          >
            <div>
              <motion.p
                variants={fadeUp}
                className="lv-eyebrow text-xs font-medium tracking-[0.28em] text-lv-ink-soft uppercase"
              >
                Proceso
              </motion.p>
              <motion.h1
                variants={fadeUp}
                className="mt-3 font-display text-[2.15rem] leading-[1.1] font-semibold tracking-tight sm:text-5xl"
              >
                Tres pasos, sin prisa.
                <span className="mt-1 block text-lv-ink-soft">Con Lavilet a tu lado.</span>
              </motion.h1>
              <motion.p
                variants={fadeUp}
                className="mt-5 max-w-xl text-base leading-relaxed text-lv-ink-soft sm:text-lg"
              >
                Comprar en La Vilet no es una carrera. Te acompañamos desde la primera conversación
                hasta las llaves, para que elijas un sitio completo —no solo un plano— con la calma
                que merece.
              </motion.p>
            </div>

            <motion.div
              variants={fadeUp}
              className="relative overflow-hidden rounded-[1.5rem] ring-1 ring-lv-line"
            >
              <div className="relative aspect-[4/3] min-h-[200px]">
                <Image
                  src="/CUENCA3.jpg"
                  alt="Entorno de Cuenca cerca de La Vilet"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 40vw"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-lv-bg/75 via-transparent to-transparent" />
                <p className="absolute inset-x-0 bottom-0 p-5 text-sm leading-snug text-lv-ink sm:p-6">
                  Del interés a la entrega: un camino claro, con showroom, tipologías reales y un
                  equipo que responde.
                </p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section className="pb-16 lg:pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            className="grid gap-5 md:grid-cols-3"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.25 }}
            variants={{ show: { transition: { staggerChildren: 0.12 } } }}
          >
            {STEPS.map((step, i) => (
              <motion.article
                key={step.n}
                variants={fadeUp}
                custom={i}
                whileHover={{ y: -6, transition: { duration: 0.35, ease } }}
                className="group relative overflow-hidden rounded-[1.35rem] bg-lv-bg p-6 ring-1 ring-lv-line sm:p-7"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-lv-bg transition-transform duration-500 group-hover:scale-125"
                />
                <p className="font-display text-5xl font-semibold text-lv-ink-soft">{step.n}</p>
                <h2 className="mt-4 text-xl font-semibold text-lv-ink">{step.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-lv-ink-soft">{step.body}</p>
                <p className="mt-4 border-t border-lv-line pt-4 text-sm leading-relaxed text-lv-ink-soft">
                  {step.detail}
                </p>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="pb-16 lg:pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            className="max-w-2xl"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.5 }}
            variants={{ show: { transition: { staggerChildren: 0.1 } } }}
          >
            <motion.p
              variants={fadeUp}
              className="text-xs font-medium tracking-[0.28em] text-lv-ink-soft uppercase"
            >
              Cómo te acompañamos
            </motion.p>
            <motion.h2
              variants={fadeUp}
              className="mt-3 font-display text-3xl font-semibold sm:text-4xl"
            >
              El mismo cuidado en cada etapa
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-4 text-lv-ink-soft">
              Lavilet no te deja solo después del “me interesa”. Inventario claro, recorridos reales y
              seguimiento hasta que el espacio es tuyo.
            </motion.p>
          </motion.div>

          <motion.div
            className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={{ show: { transition: { staggerChildren: 0.08 } } }}
          >
            {PILLARS.map((pillar, i) => (
              <motion.article
                key={pillar.title}
                variants={fadeUp}
                custom={i}
                whileHover={{ y: -4, transition: { duration: 0.3, ease } }}
                className="rounded-2xl bg-lv-bg p-5 text-lv-ink sm:p-6"
              >
                <p className="text-[11px] font-medium tracking-[0.2em] text-lv-ink-soft uppercase">
                  {String(i + 1).padStart(2, '0')}
                </p>
                <h3 className="mt-3 text-base font-semibold">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-lv-ink">{pillar.body}</p>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="pb-16 lg:pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.p
            className="text-xs font-medium tracking-[0.28em] text-lv-ink-soft uppercase"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, ease }}
          >
            Empieza por donde te acomode
          </motion.p>
          <motion.div
            className="mt-6 grid gap-4 md:grid-cols-3"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.25 }}
            variants={{ show: { transition: { staggerChildren: 0.1 } } }}
          >
            {PROCESS_TOUCHPOINTS.map((item, i) => (
              <motion.div key={item.title} variants={fadeUp} custom={i}>
                <Link
                  href={item.href}
                  className="group flex h-full flex-col rounded-[1.25rem] bg-lv-bg p-6 ring-1 ring-lv-line transition hover:ring-lv-line"
                >
                  <h3 className="text-lg font-semibold text-lv-ink">{item.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-lv-ink-soft">{item.body}</p>
                  <span className="mt-5 inline-flex items-center text-sm font-semibold text-lv-ink-soft group-hover:text-lv-ink">
                    {item.cta}
                    <ArrowRight size={16} className="ml-1.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
        <motion.div
          className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 overflow-hidden rounded-[1.75rem] bg-lv-bg px-8 py-10 sm:flex-row sm:items-center sm:px-12"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.7, ease }}
        >
          <div>
            <p className="text-sm font-medium text-lv-ink-soft">Showroom Lavilet</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-lv-ink sm:text-3xl">
              Agenda tu visita y recorre con calma
            </h2>
          </div>
          <Link
            href="/contacto"
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-lg bg-lv-bg px-6 text-base font-medium text-lv-ink transition-colors hover:bg-lv-bg"
          >
            Quiero agendar
          </Link>
        </motion.div>
      </section>
    </div>
  )
}
