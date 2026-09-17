'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Building2, Trees, Waves } from 'lucide-react'
import { notifyHeroLocked, resetHeroLock } from './heroLock'
import { HeroEditorial } from './HeroEditorial'
import { LaviletLockup, useLockupDocked } from './LaviletLockup'
import { useMarketingTheme } from './theme'

const HEADLINE =
  'Un lugar donde el tiempo parece detenerse, y la vida simplemente sucede.'
const WORDS = HEADLINE.split(' ')
const WORD_STAGGER = 0.16
const HERO_PHOTO = '/lavilet-exterior.jpg'
const BRAND_AT_MS = 6000

const NUVIA_FEATURES = [
  { label: 'Residencias premium', Icon: Building2 },
  { label: 'Terraza sobre la ciudad', Icon: Trees },
  { label: 'Piscina y sauna', Icon: Waves },
] as const

const INTERIOR_BASE =
  'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet'

const NUVIA_LETTERS = [
  { ch: 'L', src: '/lavilet-sala.jpg' },
  { ch: 'A', src: `${INTERIOR_BASE}/cocina_lavilet.png` },
  { ch: 'V', src: '/CUENCA2.png' },
  { ch: 'I', src: '/CUENCA4.png' },
  { ch: 'L', src: '/CUENCA3.jpg' },
  { ch: 'Ē', src: `${INTERIOR_BASE}/lavilet_terraza.png` },
  { ch: 'T', src: '/lavilet-comedor.jpg' },
] as const

const NUVIA_LETTER_CLASS =
  'block font-serif text-[clamp(1.45rem,11cqi,4.6rem)] font-bold leading-none uppercase'

function NuviaWordmark() {
  const reduce = useReducedMotion()

  return (
    <p
      aria-label="La Vilēt"
      className="relative z-20 mt-2 flex w-full max-w-[min(100%,38rem)] origin-left items-end justify-between gap-[0.02em] sm:mt-3"
    >
      {NUVIA_LETTERS.map((letter, i) => (
        <motion.span
          key={`${letter.ch}-${i}`}
          aria-hidden
          className="group relative inline-block min-w-0 shrink origin-center cursor-pointer select-none"
          whileHover={reduce ? undefined : { scale: 1.1, zIndex: 8, filter: 'brightness(1.12)' }}
          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        >
          <span
            className={`${NUVIA_LETTER_CLASS} text-transparent transition-[filter] duration-300 [text-shadow:0_8px_18px_rgba(20,16,12,0.22)] [-webkit-text-stroke:0.014em_rgba(248,244,236,0.82)] group-hover:[-webkit-text-stroke:0.018em_rgba(255,252,246,0.95)]`}
          >
            {letter.ch}
          </span>
          <span
            className={`${NUVIA_LETTER_CLASS} absolute inset-0 bg-cover bg-center bg-no-repeat bg-clip-text text-transparent`}
            style={{
              backgroundImage: `url(${letter.src})`,
              WebkitTextFillColor: 'transparent',
            }}
          >
            {letter.ch}
          </span>
        </motion.span>
      ))}
    </p>
  )
}

export function HeroStage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const lockedRef = useRef(false)
  const docked = useLockupDocked()
  const { theme } = useMarketingTheme()
  const editorial = theme === '3'
  const nuvia = theme === 'dark'
  const [headline, setHeadline] = useState(false)
  const [showBrand, setShowBrand] = useState(false)
  const [showImage, setShowImage] = useState(false)

  useEffect(() => {
    if (editorial) return
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
  }, [editorial])

  function lockStill() {
    if (lockedRef.current) return
    lockedRef.current = true
    setShowBrand(false)
    setShowImage(true)
    notifyHeroLocked()
  }

  useEffect(() => {
    if (editorial) {
      notifyHeroLocked()
      return
    }
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
  }, [editorial])

  if (editorial) return <HeroEditorial />

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
          {nuvia ? (
            <>
              <div className="absolute inset-0 bg-[#cfdce8]">
                <Image
                  src={HERO_PHOTO}
                  alt="Fachada Lavilet"
                  fill
                  unoptimized
                  preload
                  className="object-contain object-right"
                  sizes="100vw"
                />
              </div>
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-[linear-gradient(180deg,#e8e8e2_0%,#f2f2f2_42%,#ecece6_100%)]" />

              <div className="absolute inset-y-0 right-0 z-[1] w-[90%] sm:w-[72%]">
                <Image
                  src={HERO_PHOTO}
                  alt="Fachada Lavilet"
                  fill
                  unoptimized
                  preload
                  className="object-cover object-[68%_center]"
                  sizes="75vw"
                />
              </div>

              <div
                className="absolute inset-y-0 left-0 z-[2] w-full sm:w-1/2 bg-[linear-gradient(90deg,rgba(242,242,242,0.48)_0%,rgba(242,242,242,0.28)_58%,rgba(242,242,242,0.05)_100%)] backdrop-blur-[7px]"
                aria-hidden
              />
            </>
          )}
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
              <p className="mb-4 font-serif text-[10px] font-medium tracking-[0.42em] text-white/80 uppercase sm:text-xs">
                Suites | Apartments
              </p>
              <p className="font-serif text-[clamp(3.75rem,14vw,8.5rem)] font-normal leading-[0.85] tracking-[-0.04em]">
                LaVilēt
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showImage && nuvia && (
            <motion.div
              key="locked-nuvia"
              className="absolute inset-0 z-20 overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[min(78%,36rem)] backdrop-blur-[10px] [mask-image:linear-gradient(to_top,black_62%,transparent)] sm:inset-y-0 sm:left-0 sm:h-auto sm:w-[min(48%,34rem)] sm:[mask-image:linear-gradient(to_right,black_68%,transparent)] lg:w-[min(42%,36rem)]"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-[linear-gradient(to_top,rgba(237,220,198,0.58)_0%,rgba(237,220,198,0.22)_46%,transparent_78%)] sm:bg-[linear-gradient(90deg,rgba(237,220,198,0.48)_0%,rgba(237,220,198,0.22)_36%,rgba(237,220,198,0.04)_52%,transparent_64%)]"
              />
              <p
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 hidden -translate-y-1/2 font-serif text-[clamp(3.2rem,8vh,6.4rem)] leading-none tracking-[0.16em] text-white/5 uppercase [writing-mode:vertical-rl] rotate-180 select-none xl:left-5 xl:block"
              >
                experience
              </p>

              <div className="@container relative flex h-full w-full flex-col justify-end px-5 pt-20 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:w-[min(100%,38rem)] sm:justify-center sm:px-10 sm:pt-24 lg:w-[min(46%,40rem)] lg:px-14">
                <p className="text-[10px] font-medium tracking-[0.38em] text-white/78 uppercase sm:text-[11px] sm:tracking-[0.42em]">
                  Residencias
                </p>
                <NuviaWordmark />
                <p className="mt-4 max-w-sm text-[15px] leading-snug text-white/92 sm:mt-6 sm:text-[18px] lg:text-[19px]">
                  Más que una estadía, una experiencia.
                </p>
                <ul className="mt-5 space-y-2.5 sm:mt-8 sm:space-y-3.5">
                  {NUVIA_FEATURES.map(({ label, Icon }) => (
                    <li
                      key={label}
                      className="flex items-center gap-2.5 text-[12px] tracking-[0.04em] text-white/88 sm:gap-3 sm:text-[13px] sm:tracking-[0.06em]"
                    >
                      <Icon size={15} strokeWidth={1.5} className="shrink-0 text-white/80" />
                      {label}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/proyectos"
                  className="mt-6 inline-flex h-11 w-fit items-center rounded-full border border-white/70 bg-white/12 px-5 text-[11px] font-medium tracking-[0.16em] text-white uppercase transition-colors hover:bg-white/22 sm:mt-9 sm:h-12 sm:px-7 sm:text-[12px]"
                >
                  Ver disponibilidad
                  <ArrowRight size={15} className="ml-2" />
                </Link>
              </div>

              <Link
                href="#nosotros"
                className="absolute right-4 bottom-5 hidden items-center text-[11px] font-medium tracking-[0.18em] text-white/85 uppercase [text-shadow:0_1px_12px_rgba(0,0,0,0.45)] transition-colors hover:text-white md:inline-flex lg:right-10 lg:bottom-8 lg:text-[12px]"
              >
                Descubre LaVilēt
                <ArrowRight size={14} className="ml-2" />
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showImage && !nuvia && (
            <motion.div
              key="locked"
              className="absolute inset-0 z-20"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              <p
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2 hidden -translate-y-1/2 font-serif text-[clamp(4.5rem,12vh,8.5rem)] leading-none tracking-[0.12em] text-[#72735A]/10 uppercase [writing-mode:vertical-rl] rotate-180 select-none sm:left-4 lg:block mkt-dark:text-[#F2F2F2]/10"
              >
                suites
              </p>

              <div className="relative flex min-h-svh w-full flex-col justify-end px-5 pt-24 pb-[max(1.75rem,env(safe-area-inset-bottom))] sm:w-1/2 sm:justify-center sm:px-10 sm:pt-28 lg:px-16">
                <div
                  aria-hidden
                  className="pointer-events-none absolute top-[18%] right-[6%] bottom-[16%] left-3 rounded-[2.5rem] bg-[#f2f2f2]/60 blur-2xl mkt-dark:bg-[#72735A]/55"
                />
                <div className="relative">
                {showImage && !docked ? (
                  <div className="origin-left sm:w-[118%]">
                    <LaviletLockup variant="hero" onMist backdrop />
                  </div>
                ) : (
                  <p className="font-serif text-[clamp(2.8rem,8vw,6.5rem)] leading-[0.85] tracking-[-0.04em] text-[#2B1A18] [text-shadow:0_1px_0_#f2f2f2,0_0_22px_#f2f2f2] mkt-dark:text-[#F2F2F2]">
                    LaVilēt
                  </p>
                )}

                <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-[#2B1A18]/82 [text-shadow:0_1px_12px_#f2f2f2] sm:mt-8 sm:text-base mkt-dark:text-[#F2F2F2]/88">
                  Un lugar donde el tiempo parece detenerse, y la vida simplemente sucede.
                </p>

                <motion.div
                  className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10 sm:gap-4"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45, duration: 0.5 }}
                >
                  <Link
                    href="/contacto"
                    className="inline-flex h-12 items-center rounded-full bg-[#72735A] px-7 text-[12px] font-semibold tracking-[0.14em] text-[#F2F2F2] uppercase shadow-[0_10px_24px_rgba(114,115,90,0.35)] transition-colors hover:bg-[#5f6049] sm:h-14 sm:px-8 mkt-dark:bg-[#F2F2F2] mkt-dark:text-[#72735A] mkt-dark:hover:bg-[#e8e8e2]"
                  >
                    Agendar visita
                  </Link>
                  <Link
                    href="/proyectos"
                    className="inline-flex h-12 items-center rounded-full bg-[#f2f2f2]/80 px-5 text-[12px] font-semibold tracking-[0.14em] text-[#2B1A18] uppercase shadow-[0_8px_20px_rgba(242,242,242,0.55)] transition-colors hover:bg-[#f2f2f2] sm:h-14 mkt-dark:bg-[#72735A]/80 mkt-dark:text-[#F2F2F2]"
                  >
                    Ver proyectos
                    <ArrowRight size={16} className="ml-2" />
                  </Link>
                </motion.div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
