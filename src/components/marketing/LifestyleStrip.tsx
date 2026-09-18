'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Pause, Play, Volume2, VolumeX, X } from 'lucide-react'

const CLIPS = [
  {
    src: 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/video-lavilet/0914(5).mov',
    title: 'Luz',
    poster:
      'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/lavilet_terraza.png',
  },
  {
    src: 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/video-lavilet/0914(1).mov',
    title: 'Tiempo',
    poster: '/lavilet-comedor.jpg',
  },
  {
    src: 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/video-lavilet/0914(2).mov',
    title: 'Espacio',
    poster: '/lavilet-exterior.jpg',
  },
  {
    src: 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/video-lavilet/0914(3).mov',
    title: 'Agua',
    poster: '/CUENCA4.png',
  },
] as const

const PARADE = [
  { ch: 'L', bg: '#C45C3E', tilt: -5 },
  { ch: 'a', bg: '#BDA27E', tilt: 4 },
  { ch: 'V', bg: '#72735A', tilt: -4 },
  { ch: 'i', bg: '#8B8C74', tilt: 5 },
  { ch: 'l', bg: '#C45C3E', tilt: -5 },
  { ch: 'ē', bg: '#BDA27E', tilt: 4 },
  { ch: 't', bg: '#72735A', tilt: -4 },
] as const

type Clip = (typeof CLIPS)[number]

function ClipVideo({
  clip,
  paused,
  onOpen,
}: {
  clip: Clip
  paused: boolean
  onOpen: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (paused || reduce) {
      el.pause()
      return
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void el.play()
        else el.pause()
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [paused, reduce])

  return (
    <article className="relative aspect-[3/4] overflow-hidden rounded-[1.25rem] bg-[#2B1A18]">
      <video
        ref={ref}
        className="absolute inset-0 h-full w-full object-cover"
        src={clip.src}
        poster={clip.poster}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/15 to-black/25" />
      <h3 className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center font-serif text-[clamp(2rem,3.4vw,2.75rem)] leading-none font-normal tracking-[-0.03em] text-white [text-shadow:0_1px_18px_rgba(0,0,0,0.45)]">
        {clip.title}
      </h3>
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-10 cursor-pointer"
        aria-label={`Ver video ${clip.title}`}
      />
    </article>
  )
}

function ClipLightbox({ clip, onClose }: { clip: Clip | null; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const reduce = useReducedMotion()
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(false)
  const [progress, setProgress] = useState(0)
  const closeLightbox = useCallback(() => {
    setPlaying(true)
    setMuted(false)
    setProgress(0)
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!clip) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLightbox()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [clip, closeLightbox])

  useEffect(() => {
    if (!clip) return
    const el = videoRef.current
    if (!el) return
    el.muted = false
    el.volume = 1
    const start = el.play()
    if (start) {
      void start.catch(() => {
        el.muted = true
        setMuted(true)
        void el.play()
      })
    }
  }, [clip])

  if (typeof document === 'undefined') return null

  function togglePlay() {
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      void el.play()
      setPlaying(true)
    } else {
      el.pause()
      setPlaying(false)
    }
  }

  function toggleMute() {
    const el = videoRef.current
    if (!el) return
    el.muted = !el.muted
    setMuted(el.muted)
  }

  return createPortal(
    <AnimatePresence>
      {clip ? (
        <motion.div
          key={clip.title}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-8"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <button
            type="button"
            aria-label="Cerrar video"
            className="absolute inset-0 bg-[#1a0f0e]/70 backdrop-blur-md"
            onClick={closeLightbox}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={clip.title}
            className="relative z-10 w-[min(92vw,28rem)] overflow-hidden rounded-[1.75rem] bg-[#0d0807] shadow-[0_40px_90px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
            initial={reduce ? false : { opacity: 0, scale: 0.92, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative aspect-[3/4] bg-black">
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                src={clip.src}
                poster={clip.poster}
                playsInline
                loop
                preload="metadata"
                controlsList="nodownload"
                onClick={togglePlay}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(event) => {
                  const el = event.currentTarget
                  if (!el.duration) return
                  setProgress(el.currentTime / el.duration)
                }}
              />

              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />

              <AnimatePresence>
                {!playing ? (
                  <motion.button
                    type="button"
                    initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduce ? undefined : { opacity: 0, scale: 0.9 }}
                    onClick={togglePlay}
                    className="absolute inset-0 z-10 flex items-center justify-center"
                    aria-label="Reproducir"
                  >
                    <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/18 text-white backdrop-blur-md ring-1 ring-white/25">
                      <Play size={28} fill="currentColor" className="ml-0.5" />
                    </span>
                  </motion.button>
                ) : null}
              </AnimatePresence>

              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Cerrar"
                className="absolute top-4 right-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur-md ring-1 ring-white/15 transition-colors hover:bg-white/20"
              >
                <X size={18} />
              </button>

              <div className="absolute inset-x-0 bottom-0 z-20 p-4">
                <div className="h-0.5 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-white"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/90 transition-colors hover:text-white"
                    aria-label={playing ? 'Pausar' : 'Reproducir'}
                  >
                    {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                  </button>
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/90 transition-colors hover:text-white"
                    aria-label={muted ? 'Activar sonido' : 'Silenciar'}
                  >
                    {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

function LaviletLetterParade() {
  const reduce = useReducedMotion()

  return (
    <div
      className="relative mb-9 h-24 overflow-hidden border-y border-[#72735A]/14 sm:h-28"
      aria-hidden
    >
      <div className="absolute inset-0 flex items-center">
        <motion.div
          className="absolute flex w-max items-end gap-1.5 sm:gap-2"
          initial={reduce ? { left: '50%', x: '-50%' } : { left: '-28%' }}
          animate={reduce ? undefined : { left: ['-28%', '108%'] }}
          transition={
            reduce
              ? undefined
              : {
                  duration: 8.5,
                  repeat: Infinity,
                  repeatDelay: 1.1,
                  ease: 'linear',
                }
          }
        >
          {PARADE.map((letter, index) => (
            <motion.span
              key={`${letter.ch}-${index}`}
              className="inline-flex h-9 w-8 items-center justify-center font-serif text-[1.35rem] leading-none text-[#F4F1EA] sm:h-11 sm:w-10 sm:text-[1.65rem]"
              style={{ backgroundColor: letter.bg }}
              animate={
                reduce
                  ? undefined
                  : {
                      y: [0, index % 2 === 0 ? -9 : -4, 0, index % 2 === 0 ? -4 : -9, 0],
                      rotate: [letter.tilt, 0, -letter.tilt, 0, letter.tilt],
                  }
              }
              transition={
                reduce
                  ? undefined
                  : {
                      duration: 1.05,
                      repeat: Infinity,
                      delay: index * 0.1,
                      ease: 'easeInOut',
                    }
              }
            >
              {letter.ch}
            </motion.span>
          ))}

          <motion.span
            className="ml-1 inline-flex h-10 w-10 items-center justify-center sm:h-12 sm:w-12"
            animate={
              reduce
                ? undefined
                : {
                    y: [0, -5, 0, -10, 0],
                    rotate: [0, 3, 0, -3, 0],
                  }
            }
            transition={
              reduce
                ? undefined
                : {
                    duration: 1.1,
                    repeat: Infinity,
                    delay: PARADE.length * 0.1,
                    ease: 'easeInOut',
                  }
            }
          >
            <svg viewBox="0 0 32 32" className="h-9 w-9 sm:h-10 sm:w-10">
              <motion.ellipse
                cx="11"
                cy="12"
                rx="2.7"
                ry="2.7"
                fill="#C45C3E"
                animate={reduce ? { ry: 2.7 } : { ry: [2.7, 2.7, 0.12, 0.12, 2.7] }}
                transition={
                  reduce
                    ? undefined
                    : {
                        duration: 0.9,
                        repeat: Infinity,
                        repeatDelay: 2.1,
                        times: [0, 0.25, 0.42, 0.68, 1],
                      }
                }
              />
              <circle cx="21" cy="12" r="2.7" fill="#C45C3E" />
              <path
                d="M10 20c2.2 3.2 9.8 3.2 12 0"
                fill="none"
                stroke="#C45C3E"
                strokeWidth="2.7"
                strokeLinecap="round"
              />
            </svg>
          </motion.span>
        </motion.div>
      </div>
    </div>
  )
}

export function LifestyleStrip() {
  const [open, setOpen] = useState<Clip | null>(null)
  const reduce = useReducedMotion()

  return (
    <section
      id="showroom"
      className="relative z-20 overflow-hidden bg-[#e9e1d6] py-16 sm:py-20 lg:py-24"
      aria-labelledby="showroom-title"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-55 mix-blend-multiply"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0 4px, rgba(114,115,90,0.035) 4px 5px), repeating-linear-gradient(90deg, transparent 0 5px, rgba(114,115,90,0.028) 5px 6px)',
        }}
      />
      <div className="relative z-10 mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
        <motion.div
          className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] lg:items-end"
          initial={reduce ? false : { opacity: 0, y: 36 }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.45 }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        >
          <div>
            <p className="text-[11px] font-medium tracking-[0.32em] text-[#C45C3E] uppercase">
              Showroom 360°
            </p>
            <h2
              id="showroom-title"
              className="mt-4 max-w-4xl font-serif text-[clamp(2.8rem,6.4vw,6rem)] leading-[0.88] tracking-[-0.045em] text-[#72735A]"
            >
              Recorre el edificio,
              <span className="block text-[#BDA27E]">planta por planta.</span>
            </h2>
          </div>
          <div className="max-w-lg border-l-2 border-[#C45C3E]/55 pl-5 lg:justify-self-end lg:pb-2 lg:pl-7">
            <p className="text-[10px] font-semibold tracking-[0.26em] text-[#8B8C74] uppercase">
              Antes de visitar
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-[#2B1A18]/76 sm:text-[17px]">
              Entra a las tipologías, compara distribuciones y decide qué espacio quieres
              conocer en persona.
            </p>
            <Link
              href="/tour"
              className="mt-5 inline-flex h-11 items-center rounded-full bg-[#72735A] px-5 text-[11px] font-semibold tracking-[0.14em] text-[#f4f1ea] uppercase transition-colors hover:bg-[#5f6049]"
            >
              Recorrer en 360°
              <ArrowRight size={14} className="ml-2" />
            </Link>
          </div>
        </motion.div>

        <LaviletLetterParade />

        <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 lg:gap-4">
          {CLIPS.map((clip) => (
            <div key={clip.title} className="min-w-[82vw] snap-center sm:min-w-0">
              <ClipVideo
                clip={clip}
                paused={open !== null}
                onOpen={() => setOpen(clip)}
              />
            </div>
          ))}
        </div>
      </div>
      <ClipLightbox clip={open} onClose={() => setOpen(null)} />
    </section>
  )
}
