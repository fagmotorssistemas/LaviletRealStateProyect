'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { LaviletLockup, useLockupDocked } from './LaviletLockup'

const HEADLINE =
  'Un lugar donde el tiempo parece detenerse, y la vida simplemente sucede.'
const WORDS = HEADLINE.split(' ')
const WORD_STAGGER = 0.16
const FACHADA_SRC = '/lavilet%20frente%20real.png'
const BRAND_AT_MS = 6000

export function HeroStage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const lockedRef = useRef(false)
  const docked = useLockupDocked()
  const [headline, setHeadline] = useState(false)
  const [showBrand, setShowBrand] = useState(false)
  const [showImage, setShowImage] = useState(false)

  useEffect(() => {
    const showHeadline = window.setTimeout(() => setHeadline(true), 2000)
    const hideHeadline = window.setTimeout(() => setHeadline(false), 5300)
    const showName = window.setTimeout(() => {
      if (!lockedRef.current) setShowBrand(true)
    }, BRAND_AT_MS)
    return () => {
      window.clearTimeout(showHeadline)
      window.clearTimeout(hideHeadline)
      window.clearTimeout(showName)
    }
  }, [])

  function handleEnded() {
    lockedRef.current = true
    setShowBrand(false)
    setShowImage(true)
  }

  return (
    <section id="inicio" className="relative min-h-svh">
      <div className="absolute inset-0 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          playsInline
          aria-hidden
          onEnded={handleEnded}
        >
          <source src="/lavilet%20video.mp4" type="video/mp4" />
        </video>

        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: showImage ? 1 : 0 }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <Image
            src={FACHADA_SRC}
            alt="Fachada Lavilet"
            fill
            className="object-cover"
            sizes="100vw"
            preload
          />
        </motion.div>

        <motion.div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#1a0f0e] via-[#2B1A18]/50 to-[#2B1A18]/20"
          animate={{ opacity: showImage ? 0 : 1 }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent"
          animate={{ opacity: showImage ? 1 : 0 }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      <h1 className="sr-only">La Vilet</h1>

      <div className="relative z-10 min-h-svh">
        <AnimatePresence>
          {headline && (
            <motion.p
              key="headline"
              className="absolute inset-0 flex items-center justify-center overflow-hidden px-3 text-center font-medium tracking-wide text-white whitespace-nowrap text-[clamp(0.52rem,2.9vw,1.65rem)] sm:px-6"

              exit={{ opacity: 0, y: -16, filter: 'blur(8px)' }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            >
              {WORDS.map((word, i) => (
                <motion.span
                  key={`${word}-${i}`}
                  className="mr-[0.35em] inline-block"
                  initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{
                    duration: 0.55,
                    delay: i * WORD_STAGGER,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  {word}
                </motion.span>
              ))}
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showBrand && !showImage && (
            <motion.div
              key="brand"
              className="absolute inset-0 flex flex-col items-center justify-center px-4 text-white"
              initial={{ opacity: 0, y: 18, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -12, filter: 'blur(8px)' }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="mb-4 font-sans text-[10px] font-medium tracking-[0.42em] text-white/80 uppercase sm:text-xs">
                Suites | Apartments
              </p>
              <p className="font-serif text-[clamp(3.75rem,14vw,8.5rem)] font-normal leading-[0.85] tracking-[-0.04em]">
                LaVilēt
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showImage && (
            <motion.div
              key="locked"
              className="absolute inset-0 flex flex-col justify-end px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[4.75rem] sm:px-10 sm:pb-10 sm:pt-20 lg:px-16 lg:pb-14"
            >
              <p className="absolute bottom-28 left-3 hidden whitespace-nowrap text-[10px] font-medium tracking-[0.32em] text-white/65 uppercase md:block md:left-8 md:bottom-36 [writing-mode:vertical-rl] rotate-180">
                Desliza para explorar
              </p>

              <div className="ml-2 flex flex-col sm:ml-8 lg:ml-12">
                {showImage && !docked && <LaviletLockup variant="hero" />}
                <motion.div
                  className="mt-5 flex flex-wrap items-center gap-3 sm:mt-6 sm:gap-4"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.2, duration: 0.5 }}
                >
                  <a
                    href="#contacto"
                    className="inline-flex h-10 items-center bg-white px-5 text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#f7f3ee]"
                  >
                    Agendar visita
                  </a>
                  <a
                    href="#proyectos"
                    className="inline-flex items-center text-[11px] font-medium tracking-[0.16em] text-white uppercase transition-colors hover:text-[#BDA27E]"
                  >
                    Ver proyectos
                    <ArrowRight size={14} className="ml-2" />
                  </a>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
