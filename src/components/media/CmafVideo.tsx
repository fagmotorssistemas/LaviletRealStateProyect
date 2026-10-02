'use client'

import { useEffect, useRef, useState, type Ref } from 'react'

type Props = {
  mp4: string
  hls?: string
  poster?: string
  className?: string
  label?: string
  loop?: boolean
  autoPlay?: boolean
  /** Si es true, el archivo no se pide hasta que pase a false. */
  defer?: boolean
  onPlaying?: () => void
  onEnded?: () => void
  videoRef?: Ref<HTMLVideoElement>
}

/** Reproduce HLS CMAF si el navegador lo necesita y, si no, el MP4 con faststart. */
export function CmafVideo({
  mp4,
  hls,
  poster,
  className,
  label,
  loop = true,
  autoPlay = true,
  defer = false,
  onPlaying,
  onEnded,
  videoRef,
}: Props) {
  const localRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const video = localRef.current
    if (!video || defer) return
    let cancelled = false
    let detach = () => {}

    const start = async () => {
      const tryPlay = () => {
        if (!autoPlay || cancelled) return
        void video.play().catch(() => undefined)
      }
      if (hls && video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hls
        video.addEventListener('loadeddata', tryPlay, { once: true })
      } else if (hls) {
        const { default: Hls } = await import('hls.js')
        if (cancelled) return
        if (Hls.isSupported()) {
          const player = new Hls({ enableWorker: true, startLevel: -1 })
          player.loadSource(hls)
          player.attachMedia(video)
          player.on(Hls.Events.MANIFEST_PARSED, tryPlay)
          detach = () => player.destroy()
        } else {
          video.src = mp4
          video.addEventListener('loadeddata', tryPlay, { once: true })
        }
      } else {
        video.src = mp4
        video.addEventListener('loadeddata', tryPlay, { once: true })
      }
    }
    void start()
    return () => {
      cancelled = true
      detach()
    }
  }, [hls, mp4, autoPlay, defer])

  return (
    <>
      {poster ? (
        <img
          src={poster}
          alt=""
          className={`${className ?? ''} transition-opacity duration-[400ms] ease-linear ${playing ? 'opacity-0' : 'opacity-100'}`}
        />
      ) : null}
      <video
        ref={(node) => {
          localRef.current = node
          if (typeof videoRef === 'function') videoRef(node)
          else if (videoRef && 'current' in videoRef) videoRef.current = node
        }}
        poster={poster}
        muted
        loop={loop}
        playsInline
        preload="metadata"
        aria-label={label}
        onPlaying={() => {
          setPlaying(true)
          onPlaying?.()
        }}
        onEnded={onEnded}
        className={`${className ?? ''} transition-opacity duration-[400ms] ease-linear ${playing || !poster ? 'opacity-100' : 'opacity-0'}`}
      />
    </>
  )
}
