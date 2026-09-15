'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { notifyHeroLocked, resetHeroLock } from './heroLock'
import { LaviletLockup, useLockupDocked } from './LaviletLockup'

const HEADLINE =
  'Un lugar donde el tiempo parece detenerse, y la vida simplemente sucede.'
const WORDS = HEADLINE.split(' ')
const WORD_STAGGER = 0.16
const FACHADA_SRC =
  'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/imagenfinalrbg-removebg.png'
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

  function lockStill() {
    if (lockedRef.current) return
    lockedRef.current = true
    setShowBrand(false)
    setShowImage(true)
    notifyHeroLocked()
  }

  useEffect(() => {
    resetHeroLock()
    const video = videoRef.current
    if (!video) return

    const onTime = () => {
      if (video.ended || (video.duration > 0 && video.currentTime >= video.duration - 0.08)) {
        lockStill()
      }
    }

    video.addEventListener('ended', lockStill)
    video.addEventListener('error', lockStill)
    video.addEventListener('timeupdate', onTime)
    if (video.ended) lockStill()

    return () => {
      video.removeEventListener('ended', lockStill)
      video.removeEventListener('error', lockStill)
      video.removeEventListener('timeupdate', onTime)
    }
  }, [])

  return (
    <section id="inicio" className="relative min-h-svh scroll-mt-0">
      <div className="absolute inset-0 overflow-hidden">
        <motion.video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          playsInline
          aria-hidden
          onEnded={lockStill}
          animate={{ opacity: showImage ? 0 : 1 }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <source
            src="https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/video-lavilet/lavilet_video_principal_!.mp4"
            type="video/mp4"
          />
        </motion.video>

        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: showImage ? 1 : 0 }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#f2f2f2_0%,#f0f0ec_40%,#e4e4de_100%)] mkt-dark:bg-[linear-gradient(180deg,#72735A_0%,#72735A_100%)]" />

          <div className="absolute inset-0 z-[1] flex flex-col px-4 pt-20 sm:pt-24 lg:pt-28">
            {showImage && !docked ? (
              <div className="pointer-events-none flex shrink-0 justify-center pb-2 sm:pb-3">
                <LaviletLockup variant="hero" onMist backdrop />
              </div>
            ) : null}

            <div className="relative mx-auto min-h-0 w-full max-w-5xl flex-1">
              <Image
                src={FACHADA_SRC}
                alt="Fachada Lavilet"
                fill
                unoptimized
                className="object-contain object-bottom"
                sizes="(max-width: 1024px) 92vw, 75vw"
                preload
                style={{
                  WebkitMaskImage:
                    'linear-gradient(to bottom, #000 88%, transparent 100%)',
                  maskImage:
                    'linear-gradient(to bottom, #000 88%, transparent 100%)',
                }}
              />
            </div>

            <div className="h-20 shrink-0 sm:h-24" />
          </div>

          <div className="pointer-events-none absolute inset-y-0 left-0 z-[3] w-[22%] bg-gradient-to-r from-[#e4e4de] via-[#e4e4de]/40 to-transparent sm:w-[28%] mkt-dark:from-[#72735A] mkt-dark:via-[#72735A]/30" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-[3] w-[22%] bg-gradient-to-l from-[#e4e4de] via-[#e4e4de]/40 to-transparent sm:w-[28%] mkt-dark:from-[#72735A] mkt-dark:via-[#72735A]/30" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-20 bg-gradient-to-t from-[#e4e4de] to-transparent mkt-dark:from-[#72735A]" />
        </motion.div>

        <motion.div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#1a0f0e] via-[#2B1A18]/50 to-[#2B1A18]/20"
          animate={{ opacity: showImage ? 0 : 1 }}
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="ml-2 flex flex-col sm:ml-8 lg:ml-12">
                <motion.div
                  className="mt-5 flex flex-wrap items-center gap-3 sm:mt-6 sm:gap-4"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.2, duration: 0.5 }}
                >
                  <Link
                    href="/contacto"
                    className="inline-flex h-12 items-center bg-[#72735A] px-6 text-[13px] font-bold tracking-[0.12em] text-[#F2F2F2] uppercase transition-colors hover:bg-[#8B8C74] sm:h-14 sm:px-7 sm:text-[14px]"
                  >
                    Agendar visita
                  </Link>
                  <Link
                    href="/proyectos"
                    className="inline-flex items-center text-[13px] font-bold tracking-[0.12em] text-[#72735A] uppercase transition-colors hover:text-[#8B8C74] sm:text-[14px] mkt-dark:text-[#F2F2F2]"
                  >
                    Ver proyectos
                    <ArrowRight size={16} className="ml-2" />
                  </Link>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
