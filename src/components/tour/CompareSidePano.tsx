'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Viewer } from '@photo-sphere-viewer/core'
import '@photo-sphere-viewer/core/index.css'
import { attachForceLandscapePan } from '@/lib/tour/forceLandscapePan'
import { cn } from '@/lib/utils'

export type ComparePanoPose = {
  yaw: number
  pitch: number
  zoom: number
}

type CompareSidePanoProps = {
  url: string | null
  className?: string
  /** Si true, usa imagen plana (más fiable / sin 2º WebGL). */
  flatFallback?: boolean
  /** Pose inicial / React (fallback). */
  syncPose?: ComparePanoPose | null
  /** Pose en vivo del visor A — se lee cada frame (sync fluido). */
  syncPoseRef?: MutableRefObject<ComparePanoPose | null>
  onPoseChange?: (pose: ComparePanoPose) => void
  /** Remapea el dedo si el tour root usa CSS rotate(90deg). */
  remapTouch?: boolean
}

const EPS = 0.0009

function posesClose(a: ComparePanoPose, b: ComparePanoPose) {
  return (
    Math.abs(a.yaw - b.yaw) < EPS &&
    Math.abs(a.pitch - b.pitch) < EPS &&
    Math.abs(a.zoom - b.zoom) < 0.15
  )
}

function readPose(viewer: Viewer): ComparePanoPose {
  const pos = viewer.getPosition()
  return { yaw: pos.yaw, pitch: pos.pitch, zoom: viewer.getZoomLevel() }
}

function applyPose(viewer: Viewer, pose: ComparePanoPose) {
  try {
    viewer.rotate({ yaw: pose.yaw, pitch: pose.pitch })
    viewer.zoom(pose.zoom)
  } catch {
    /* ignore */
  }
}

function safeAutoSize(viewer: Viewer | null | undefined) {
  if (!viewer) return
  try {
    viewer.autoSize()
    viewer.needsUpdate()
  } catch {
    /* ignore */
  }
}

function waitForSize(el: HTMLElement, isCancelled: () => boolean): Promise<boolean> {
  if (el.clientWidth > 2 && el.clientHeight > 2) return Promise.resolve(true)

  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      try {
        ro.disconnect()
      } catch {
        /* ignore */
      }
      window.clearInterval(poll)
      window.clearTimeout(timeout)
      resolve(ok)
    }

    const ro = new ResizeObserver(() => {
      if (isCancelled()) {
        done(false)
        return
      }
      if (el.clientWidth > 2 && el.clientHeight > 2) done(true)
    })
    ro.observe(el)

    const poll = window.setInterval(() => {
      if (isCancelled()) {
        done(false)
        return
      }
      if (el.clientWidth > 2 && el.clientHeight > 2) done(true)
    }, 40)

    const timeout = window.setTimeout(() => done(el.clientWidth > 2 && el.clientHeight > 2), 2500)
  })
}

/** Visor 360 liviano para el lado B (comparador), con sync de cámara. */
export function CompareSidePano({
  url,
  className,
  flatFallback = false,
  syncPose = null,
  syncPoseRef,
  onPoseChange,
  remapTouch = false,
}: CompareSidePanoProps) {
  const { t } = useTourLanguage()

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const urlRef = useRef<string | null>(null)
  const applyingRef = useRef(false)
  const userDrivingRef = useRef(false)
  const userDrivingUntilRef = useRef(0)
  const onPoseChangeRef = useRef(onPoseChange)
  onPoseChangeRef.current = onPoseChange
  const syncPosePropRef = useRef(syncPose)
  syncPosePropRef.current = syncPose
  const cancelledRef = useRef(false)

  const [mode, setMode] = useState<'pano' | 'flat' | 'empty' | 'error'>(
    url ? (flatFallback ? 'flat' : 'pano') : 'empty',
  )
  const [loading, setLoading] = useState(Boolean(url) && !flatFallback)

  useEffect(() => {
    if (!url) {
      setMode('empty')
      setLoading(false)
      return
    }
    if (flatFallback) {
      setMode('flat')
      setLoading(false)
      return
    }
    setMode('pano')
  }, [url, flatFallback])

  useEffect(() => {
    if (mode !== 'pano') {
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy()
        } catch {
          /* ignore */
        }
        viewerRef.current = null
        urlRef.current = null
      }
      return
    }

    const container = containerRef.current
    if (!container || !url) return

    cancelledRef.current = false
    const isCancelled = () => cancelledRef.current
    const timers: number[] = []
    let detachRemap: (() => void) | null = null
    let onReady: (() => void) | null = null
    let emitPose: (() => void) | null = null
    let syncFromMain: (() => void) | null = null

    const bumpSize = () => {
      safeAutoSize(viewerRef.current)
      for (const ms of [50, 160, 360, 700]) {
        timers.push(window.setTimeout(() => safeAutoSize(viewerRef.current), ms))
      }
    }

    const run = async () => {
      setLoading(true)
      const sized = await waitForSize(container, isCancelled)
      if (isCancelled()) return
      if (!sized) {
        setMode('flat')
        setLoading(false)
        return
      }

      let viewer = viewerRef.current
      const initial = syncPoseRef?.current ?? syncPosePropRef.current ?? null

      if (!viewer) {
        try {
          viewer = new Viewer({
            container,
            navbar: false,
            loadingTxt: '',
            lang: { loading: '' },
            canvasBackground: '#111',
            defaultZoomLvl: initial?.zoom ?? 0,
            defaultYaw: initial?.yaw,
            defaultPitch: initial?.pitch,
            maxFov: 90,
            minFov: 40,
            mousewheelCtrlKey: false,
            touchmoveTwoFingers: false,
            mousemove: !remapTouch,
            moveSpeed: 1.35,
            moveInertia: 0.5,
            rendererParameters: {
              alpha: true,
              antialias: false,
              powerPreference:
                typeof navigator !== 'undefined' &&
                (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
                  ? 'low-power'
                  : 'high-performance',
              preserveDrawingBuffer: false,
            },
          })
          viewerRef.current = viewer
        } catch {
          if (!isCancelled()) {
            setMode('flat')
            setLoading(false)
          }
          return
        }
      } else {
        try {
          viewer.setOption('mousemove', !remapTouch)
        } catch {
          /* ignore */
        }
      }

      emitPose = () => {
        if (isCancelled() || applyingRef.current || !viewerRef.current) return
        userDrivingRef.current = true
        userDrivingUntilRef.current = performance.now() + 80
        onPoseChangeRef.current?.(readPose(viewerRef.current))
      }

      syncFromMain = () => {
        if (isCancelled() || applyingRef.current || !viewerRef.current) return
        if (userDrivingRef.current && performance.now() < userDrivingUntilRef.current) return
        userDrivingRef.current = false
        const pose = syncPoseRef?.current ?? syncPosePropRef.current
        if (!pose) return
        const current = readPose(viewerRef.current)
        if (posesClose(current, pose)) return
        applyingRef.current = true
        applyPose(viewerRef.current, pose)
        applyingRef.current = false
      }

      onReady = () => {
        bumpSize()
        if (!isCancelled()) setLoading(false)
      }

      viewer.addEventListener('position-updated', emitPose)
      viewer.addEventListener('zoom-updated', emitPose)
      viewer.addEventListener('before-render', syncFromMain)
      viewer.addEventListener('ready', onReady)

      if (remapTouch) {
        detachRemap = attachForceLandscapePan(viewer, {
          active: () => !isCancelled() && !applyingRef.current,
          speedMult: 1.35,
          inertia: 0.45,
        })
      }

      try {
        if (url !== urlRef.current) {
          urlRef.current = url
          const pose = syncPoseRef?.current ?? syncPosePropRef.current
          await viewer.setPanorama(url, {
            transition: false,
            showLoader: false,
            ...(pose
              ? { position: { yaw: pose.yaw, pitch: pose.pitch }, zoom: pose.zoom }
              : {}),
          })
        }
        if (isCancelled()) return
        bumpSize()
        syncFromMain()
        setLoading(false)
      } catch {
        if (!isCancelled()) {
          setMode('flat')
          setLoading(false)
        }
      }
    }

    void run()

    const onResize = () => safeAutoSize(viewerRef.current)
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)

    return () => {
      cancelledRef.current = true
      detachRemap?.()
      timers.forEach((id) => window.clearTimeout(id))
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      const viewer = viewerRef.current
      if (viewer) {
        try {
          if (emitPose) viewer.removeEventListener('position-updated', emitPose)
          if (emitPose) viewer.removeEventListener('zoom-updated', emitPose)
          if (syncFromMain) viewer.removeEventListener('before-render', syncFromMain)
          if (onReady) viewer.removeEventListener('ready', onReady)
        } catch {
          /* ignore */
        }
        try {
          viewer.setOption('mousemove', true)
        } catch {
          /* ignore */
        }
      }
    }
  }, [mode, url, syncPoseRef, remapTouch])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || mode !== 'pano' || !syncPose) return
    if (applyingRef.current) return
    if (userDrivingRef.current && performance.now() < userDrivingUntilRef.current) return
    const current = readPose(viewer)
    if (posesClose(current, syncPose)) return
    applyingRef.current = true
    applyPose(viewer, syncPose)
    applyingRef.current = false
  }, [syncPose, mode])

  useEffect(() => {
    return () => {
      const v = viewerRef.current
      viewerRef.current = null
      urlRef.current = null
      if (v) {
        try {
          v.destroy()
        } catch {
          /* ignore */
        }
      }
      const root = containerRef.current
      if (!root) return
      root.querySelectorAll('canvas').forEach((canvas) => {
        try {
          const el = canvas as HTMLCanvasElement
          const gl = el.getContext('webgl2') || el.getContext('webgl')
          const lose = (gl as WebGLRenderingContext | null)?.getExtension?.('WEBGL_lose_context')
          lose?.loseContext()
          canvas.remove()
        } catch {
          /* ignore */
        }
      })
    }
  }, [])

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-[#111]', className)}>
      {mode === 'pano' ? (
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      ) : null}

      {mode === 'pano' && loading && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={t("")}
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover opacity-80"
          draggable={false}
        />
      ) : null}

      {mode === 'pano' && loading ? (
        <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center bg-black/25">
          <p className="rounded-md bg-black/50 px-3 py-1.5 text-[11px] tracking-wide text-white/80 uppercase">
            {t(" Cargando 360… ")}</p>
        </div>
      ) : null}

      {mode === 'flat' && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={t("")}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
          onError={() => setMode('error')}
        />
      ) : null}

      {mode === 'empty' ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/50">
          {t(" Sin tour 360 para comparar ")}</div>
      ) : null}

      {mode === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/50">
          {t(" No se pudo cargar el 360 ")}</div>
      ) : null}
    </div>
  )
}
