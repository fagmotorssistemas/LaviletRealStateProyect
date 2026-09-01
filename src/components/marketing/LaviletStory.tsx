'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { LaviletLockup, useLockupDocked } from './LaviletLockup'

const LINES = [
  'El hormigón se curva para no interrumpir el paisaje.',
  'La madera guarda la luz que entra por la tarde.',
  'Cada planta orientada a la luz del Tomebamba.',
  'Y cada balcón se abre hacia el verde, como quien no tiene prisa.',
  'Lo que se admira desde la calle es, adentro, un día cualquiera.',
]

const photoEase = [0.22, 1, 0.36, 1] as const

function PhotoPair({
  back,
  front,
  className,
}: {
  back: { src: string; alt: string }
  front: { src: string; alt: string }
  className?: string
}) {
  return (
    <motion.div
      className={cn(
        'relative mx-5 mt-12 h-[22rem] overflow-hidden sm:mx-8 sm:h-[28rem] lg:mx-0 lg:mt-0 lg:h-[min(40rem,68vh)]',
        className,
      )}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.4 }}
    >
      <motion.div
        className="absolute top-0 right-0 z-10 h-[53%] w-[53%] overflow-hidden"
        variants={{
          hidden: { y: 180, opacity: 0 },
          show: {
            y: 0,
            opacity: 1,
            transition: { duration: 1.05, ease: photoEase },
          },
        }}
      >
        <Image
          src={back.src}
          alt={back.alt}
          fill
          className="object-cover"
          sizes="(max-width: 1024px) 55vw, 24vw"
        />
      </motion.div>
      <motion.div
        className="absolute bottom-0 left-0 z-20 h-[53%] w-[53%] overflow-hidden shadow-[0_18px_40px_rgba(43,26,24,0.18)]"
        variants={{
          hidden: { y: -180, opacity: 0 },
          show: {
            y: 0,
            opacity: 1,
            transition: { duration: 1.05, ease: photoEase, delay: 0.08 },
          },
        }}
      >
        <Image
          src={front.src}
          alt={front.alt}
          fill
          className="object-cover"
          sizes="(max-width: 1024px) 60vw, 26vw"
        />
      </motion.div>
    </motion.div>
  )
}

export function LaviletStory() {
  const docked = useLockupDocked()

  return (
    <section id="nosotros" className="relative scroll-mt-24 py-20 lg:py-28">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_min(42vw,36rem)] lg:items-start">
        <div className="relative mx-auto max-w-5xl px-5 sm:px-8 lg:mx-0 lg:max-w-none lg:pr-10 lg:pl-[max(1.25rem,calc((100vw-64rem)/2))]">
          <div className="grid items-start gap-10 sm:grid-cols-[auto_1fr] sm:gap-12 lg:gap-16">
            <div className="flex min-h-[9rem] min-w-[16rem] items-start sm:min-h-[12rem] sm:min-w-[22rem]">
              {docked && <LaviletLockup variant="story" />}
            </div>

            <p className="max-w-md text-[15px] leading-relaxed text-[#2B1A18]/80 sm:text-base">
              {LINES.map((line) => (
                <span key={line} className="mt-1.5 block first:mt-0">
                  {line}
                </span>
              ))}
            </p>
          </div>

          <h2 className="mt-12 max-w-3xl text-3xl font-bold lowercase leading-[1.1] text-[#C45C3E] sm:mt-16 sm:text-5xl lg:text-6xl">
            un lugar donde el tiempo se detiene
          </h2>

          <blockquote className="mt-10 max-w-2xl border-l-[3px] border-[#C45C3E] pl-5 sm:mt-12 sm:pl-6">
            <p className="text-base leading-relaxed text-[#2B1A18]/80 sm:text-lg">
              La Vilet nace de una idea simple: que ganar altura no debería alejarte de la ciudad,
              sino devolvértela entera. En Puertas del Sol, el proyecto ordena su vida alrededor de
              lo que ya está ahí — el Tomebamba a pocos pasos, el parque lineal como una extensión
              del edificio, y una terraza que reúne lo que un departamento no alcanza a contener
              solo. Cada planta está pensada para que la luz de Cuenca entre temprano y se quede.
            </p>
            <footer className="mt-5 text-[11px] font-medium tracking-[0.16em] text-[#2B1A18]/45 uppercase">
              Lavilet · Historia
            </footer>
          </blockquote>

          <div className="hidden h-[70vh] lg:block" aria-hidden="true" />
        </div>

        <div className="lg:sticky lg:top-28 lg:z-10 lg:self-start">
          <PhotoPair
            back={{ src: '/CUENCA1.png', alt: 'Cuenca desde las alturas' }}
            front={{ src: '/CUENCA4.png', alt: 'El río Tomebamba en Cuenca' }}
          />
        </div>
      </div>
    </section>
  )
}
