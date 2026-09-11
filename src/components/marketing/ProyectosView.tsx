'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { COMPLETE_PLACE, FEATURED_SPACES, WHY_LAVILET } from '@/lib/marketing/site'

const ease = [0.22, 1, 0.36, 1] as const

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay: i * 0.1, ease },
  }),
}

export function ProyectosView() {
  return (
    <div className="relative z-20 overflow-hidden bg-[#f7f3ee]">
      <div
        aria-hidden
        className="pointer-events-none absolute top-20 right-0 h-80 w-80 rounded-full bg-[#BDA27E]/15 blur-3xl"
      />

      <section className="pt-24 pb-16 sm:pt-28 lg:pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            className="max-w-3xl"
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.12 } } }}
          >
            <motion.p
              variants={fadeUp}
              custom={0}
              className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase"
            >
              Proyectos
            </motion.p>
            <motion.h1
              variants={fadeUp}
              custom={1}
              className="mt-3 font-display text-[2.15rem] leading-[1.1] font-semibold tracking-tight sm:text-5xl lg:text-[3.25rem]"
            >
              No es solo un edificio.
              <span className="mt-1 block text-[#C45C3E]">Es un sitio completo.</span>
            </motion.h1>
            <motion.p
              variants={fadeUp}
              custom={2}
              className="mt-5 max-w-2xl text-base leading-relaxed text-[#2B1A18]/65 sm:text-lg"
            >
              Lavilet ordena la vida alrededor de lo que ya importa: vivir, trabajar cerca, mirar el
              Tomebamba y tener lo esencial sin convertir cada necesidad en un viaje. Elegirnos es
              elegir un lugar que se sostiene solo.
            </motion.p>
          </motion.div>

          <motion.div
            className="relative mt-12 overflow-hidden rounded-[1.75rem] lg:mt-16"
            initial={{ opacity: 0, y: 36 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.25, ease }}
          >
            <div className="relative aspect-[21/9] min-h-[240px] sm:min-h-[320px]">
              <Image
                src="/CUENCA1.png"
                alt="Cuenca y el entorno de La Vilet"
                fill
                priority
                className="object-cover"
                sizes="100vw"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#2B1A18]/80 via-[#2B1A18]/45 to-transparent" />
              <div className="absolute inset-0 flex items-end p-6 sm:p-10 lg:p-12">
                <div className="max-w-lg">
                  <p className="text-[11px] font-medium tracking-[0.22em] text-[#BDA27E] uppercase">
                    Por qué elegirnos
                  </p>
                  <p className="mt-3 font-display text-2xl leading-snug font-semibold text-white sm:text-3xl">
                    Porque no tienes que salir a buscar una vida: ya está armada a tu alrededor.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="pb-16 lg:pb-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            className="grid gap-8 border-y border-[#2B1A18]/10 py-10 sm:grid-cols-3 sm:gap-6 lg:py-14"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.35 }}
            variants={{ show: { transition: { staggerChildren: 0.12 } } }}
          >
            {COMPLETE_PLACE.map((item, i) => (
              <motion.div key={item.title} variants={fadeUp} custom={i}>
                <p className="font-display text-4xl font-semibold text-[#BDA27E]/35">
                  {String(i + 1).padStart(2, '0')}
                </p>
                <h2 className="mt-3 text-lg font-semibold text-[#2B1A18]">{item.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/60">{item.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="pb-16 lg:pb-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.4 }}
              variants={{ show: { transition: { staggerChildren: 0.1 } } }}
            >
              <motion.p
                variants={fadeUp}
                className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase"
              >
                La mejor decisión
              </motion.p>
              <motion.h2
                variants={fadeUp}
                className="mt-3 font-display text-3xl leading-tight font-semibold sm:text-4xl"
              >
                Un lugar donde quedarte tiene sentido
              </motion.h2>
              <motion.p variants={fadeUp} className="mt-4 text-sm leading-relaxed text-[#2B1A18]/65 sm:text-base">
                Aquí la terraza reúne lo que un departamento no alcanza solo, los locales animan la
                planta y el río marca el ritmo. No es marketing de “amenities”: es no necesitar irte
                para sentirte completo.
              </motion.p>
              <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/tour"
                  className="inline-flex h-11 items-center rounded-lg bg-[#2B1A18] px-5 text-[11px] font-semibold tracking-[0.16em] text-white uppercase transition-colors hover:bg-[#3d2a24]"
                >
                  Ver showroom 360°
                </Link>
                <Link
                  href="/contacto"
                  className="inline-flex h-11 items-center rounded-lg px-5 text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase ring-1 ring-[#2B1A18]/20 transition-colors hover:bg-[#2B1A18]/5"
                >
                  Agendar visita
                </Link>
              </motion.div>
            </motion.div>

            <motion.div
              className="space-y-0 divide-y divide-[#2B1A18]/10 border-y border-[#2B1A18]/10"
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={{ show: { transition: { staggerChildren: 0.12 } } }}
            >
              {WHY_LAVILET.map((item, i) => (
                <motion.div
                  key={item.n}
                  variants={fadeUp}
                  custom={i}
                  className="grid gap-3 py-6 sm:grid-cols-[4rem_1fr] sm:gap-6"
                >
                  <p className="text-sm font-semibold tracking-[0.14em] text-[#BDA27E]">{item.n}</p>
                  <div>
                    <h3 className="text-base font-semibold text-[#2B1A18]">{item.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#2B1A18]/60">{item.body}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      <section className="pb-20 lg:pb-28">
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
              className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase"
            >
              Tipologías
            </motion.p>
            <motion.h2
              variants={fadeUp}
              className="mt-3 font-display text-3xl font-semibold sm:text-4xl"
            >
              Espacios para vivir, invertir o emprender
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-4 text-[#2B1A18]/65">
              Cada tipología forma parte del mismo sitio. En el showroom vemos juntos unidades,
              acabados y disponibilidad real.
            </motion.p>
          </motion.div>

          <motion.div
            className="mt-12 grid gap-6 lg:grid-cols-3"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={{ show: { transition: { staggerChildren: 0.12 } } }}
          >
            {FEATURED_SPACES.map((space, i) => (
              <motion.article
                key={space.title}
                variants={fadeUp}
                custom={i}
                className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#2B1A18]/8 transition hover:shadow-xl hover:ring-[#BDA27E]/40"
              >
                <div className="relative h-56 overflow-hidden">
                  <Image
                    src={space.image}
                    alt={space.title}
                    fill
                    className="object-cover transition duration-700 group-hover:scale-105"
                    sizes="(max-width: 1024px) 100vw, 33vw"
                  />
                  <span className="absolute bottom-3 left-3 rounded-md bg-[#2B1A18]/80 px-2.5 py-1 text-[11px] font-medium text-[#BDA27E]">
                    {space.phase}
                  </span>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold">{space.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/65">{space.description}</p>
                  <Link
                    href="/"
                    className="mt-5 inline-flex items-center text-sm font-semibold text-[#BDA27E] hover:text-[#2B1A18]"
                  >
                    Consultar disponibilidad
                    <ArrowRight size={16} className="ml-1.5" />
                  </Link>
                </div>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>
    </div>
  )
}
