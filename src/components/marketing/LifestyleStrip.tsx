'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Pause, Play, Volume2, VolumeX, X } from 'lucide-react'

const CLIPS = [
  {
    src: 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/video-lavilet/0914(5).mov',
    title: 'Luz',
  },
  {
    src: 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/video-lavilet/0914(1).mov',
    title: 'Tiempo',
  },
  {
    src: 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/video-lavilet/0914(2).mov',
    title: 'Espacio',
  },
  {
    src: 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/video-lavilet/0914(3).mov',
    title: 'Agua',
  },
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
        muted
        loop
        playsInline
        preload="metadata"
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

  useEffect(() => {
    if (!clip) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [clip, onClose])

  useEffect(() => {
    if (!clip) {
      setPlaying(true)
      setMuted(false)
      setProgress(0)
      return
    }
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
            onClick={onClose}
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
                playsInline
                loop
                preload="auto"
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
                onClick={onClose}
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

export function LifestyleStrip() {
  const [open, setOpen] = useState<Clip | null>(null)

  return (
    <section className="relative z-20 pb-16 lg:pb-24" aria-label="Momentos de LaVilēt">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {CLIPS.map((clip) => (
            <ClipVideo
              key={clip.title}
              clip={clip}
              paused={open !== null}
              onOpen={() => setOpen(clip)}
            />
          ))}
        </div>
      </div>
      <ClipLightbox clip={open} onClose={() => setOpen(null)} />
    </section>
  )
}
