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
  preload?: 'none' | 'metadata' | 'auto'
  /** Si es true, el archivo no se pide hasta que pase a false. */
  defer?: boolean
  onPlaying?: () => void
  onEnded?: () => void
  onError?: () => void
  /** Primer cuadro ya pintado (requestVideoFrameCallback, o loadeddata si no existe). */
  onFirstFrame?: () => void
  videoRef?: Ref<HTMLVideoElement>
}

function safariUsesMp4(video: HTMLVideoElement) {
  if (!video.canPlayType('application/vnd.apple.mpegurl')) return false
  const ua = navigator.userAgent || ''
  return !/Chrome|CriOS|Edg|Android/i.test(ua)
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
  preload,
  defer = false,
  onPlaying,
  onEnded,
  onError,
  onFirstFrame,
  videoRef,
}: Props) {
  const localRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const autoPlayRef = useRef(autoPlay)
  const onErrorRef = useRef(onError)
  const onFirstFrameRef = useRef(onFirstFrame)
  autoPlayRef.current = autoPlay
  onErrorRef.current = onError
  onFirstFrameRef.current = onFirstFrame
  const preloadMode = preload ?? (loop ? 'auto' : 'metadata')

  useEffect(() => {
    const video = localRef.current
    if (!video || defer) return
    let cancelled = false
    let usedMp4 = !hls
    let armed = false
    let detach = () => {}
    let painted = false

    const paintFrame = () => {
      if (painted || cancelled) return
      const notify = () => {
        if (painted || cancelled) return
        painted = true
        onFirstFrameRef.current?.()
      }
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => notify())
        return
      }
      if (video.readyState >= 2) notify()
      else video.addEventListener('loadeddata', notify, { once: true })
    }
    const tryPlay = () => {
      if (!autoPlayRef.current || cancelled) return
      void video.play().catch(() => undefined)
    }
    const onReady = () => {
      paintFrame()
      tryPlay()
    }
    const fail = () => {
      if (!cancelled) onErrorRef.current?.()
    }
    const useMp4 = () => {
      if (cancelled) return
      if (usedMp4) {
        fail()
        return
      }
      usedMp4 = true
      detach()
      detach = () => {}
      armed = true
      video.src = mp4
      video.load()
      video.addEventListener('loadeddata', onReady, { once: true })
    }
    const onVideoError = () => {
      if (!armed || cancelled) return
      if (video.error?.code === 1) return
      if (usedMp4) fail()
      else useMp4()
    }
    video.addEventListener('error', onVideoError)

    const playMp4 = () => {
      usedMp4 = true
      armed = true
      video.src = mp4
      video.addEventListener('loadeddata', onReady, { once: true })
    }
    const start = async () => {
      if (!hls || safariUsesMp4(video)) {
        playMp4()
        return
      }
      const { default: Hls } = await import('hls.js')
      if (cancelled) return
      if (Hls.isSupported()) {
        const player = new Hls({ enableWorker: true, startLevel: -1, autoStartLoad: false })
        armed = true
        player.loadSource(hls)
        player.attachMedia(video)
        player.on(Hls.Events.MANIFEST_PARSED, () => {
          player.startLoad()
          paintFrame()
          tryPlay()
        })
        player.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          useMp4()
        })
        detach = () => player.destroy()
        return
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        armed = true
        video.src = hls
        video.addEventListener('loadeddata', onReady, { once: true })
        return
      }
      playMp4()
    }
    void start()
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !autoPlayRef.current || video.ended) return
      void video.play().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      video.removeEventListener('error', onVideoError)
      detach()
    }
  }, [hls, mp4, defer])

  useEffect(() => {
    const video = localRef.current
    if (!video || defer || !autoPlay) return
    void video.play().catch(() => undefined)
  }, [autoPlay, defer, mp4, hls])

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
        preload={defer ? 'none' : preloadMode}
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
