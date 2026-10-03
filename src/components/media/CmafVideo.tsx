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
    let usedMp4 = !hls
    let detach = () => {}

    const tryPlay = () => {
      if (!autoPlay || cancelled) return
      void video.play().catch(() => undefined)
    }
    const useMp4 = () => {
      if (cancelled || usedMp4) return
      usedMp4 = true
      detach()
      detach = () => {}
      video.src = mp4
      video.load()
      video.addEventListener('loadeddata', tryPlay, { once: true })
    }
    const onVideoError = () => {
      useMp4()
    }
    video.addEventListener('error', onVideoError)

    const start = async () => {
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
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return
            useMp4()
          })
          detach = () => player.destroy()
        } else {
          usedMp4 = true
          video.src = mp4
          video.addEventListener('loadeddata', tryPlay, { once: true })
        }
      } else {
        usedMp4 = true
        video.src = mp4
        video.addEventListener('loadeddata', tryPlay, { once: true })
      }
    }
    void start()
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !autoPlay || video.ended) return
      void video.play().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      video.removeEventListener('error', onVideoError)
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
        onPause={() => {
          const video = localRef.current
          if (video && !video.ended) setPlaying(false)
        }}
        onEnded={() => {
          if (!loop) setPlaying(false)
          onEnded?.()
        }}
        className={`${className ?? ''} transition-opacity duration-[400ms] ease-linear ${playing || !poster ? 'opacity-100' : 'opacity-0'}`}
      />
    </>
  )
}
