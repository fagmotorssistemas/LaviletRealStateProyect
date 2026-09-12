'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Viewer } from '@photo-sphere-viewer/core'
import '@photo-sphere-viewer/core/index.css'
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
}

const EPS = 0.0012

function posesClose(a: ComparePanoPose, b: ComparePanoPose) {
  return (
    Math.abs(a.yaw - b.yaw) < EPS &&
    Math.abs(a.pitch - b.pitch) < EPS &&
    Math.abs(a.zoom - b.zoom) < 0.2
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

/** Visor 360 liviano para el lado B (comparador), con sync de cámara. */
export function CompareSidePano({
  url,
  className,
  flatFallback = false,
  syncPose = null,
  syncPoseRef,
  onPoseChange,
}: CompareSidePanoProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const urlRef = useRef<string | null>(null)
  const applyingRef = useRef(false)
  const userDrivingRef = useRef(false)
  const onPoseChangeRef = useRef(onPoseChange)
  onPoseChangeRef.current = onPoseChange
  const syncPosePropRef = useRef(syncPose)
  syncPosePropRef.current = syncPose

  const [mode, setMode] = useState<'pano' | 'flat' | 'empty' | 'error'>(
    url ? (flatFallback ? 'flat' : 'pano') : 'empty',
  )

  useEffect(() => {
    if (!url) {
      setMode('empty')
      return
    }
    if (flatFallback) {
      setMode('flat')
      return
    }
    setMode('pano')
  }, [url, flatFallback])

  useEffect(() => {
    if (mode !== 'pano') {
      if (viewerRef.current) {
        viewerRef.current.destroy()
        viewerRef.current = null
        urlRef.current = null
      }
      return
    }

    const container = containerRef.current
    if (!container || !url) return

    let cancelled = false
    let viewer = viewerRef.current
    const initial =
      syncPoseRef?.current ?? syncPosePropRef.current ?? null

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
          rendererParameters: {
            alpha: true,
            antialias: false,
            powerPreference: 'high-performance',
          },
        })
        viewerRef.current = viewer
      } catch {
        if (!cancelled) setMode('flat')
        return
      }
    }

    const emitPose = () => {
      if (cancelled || applyingRef.current || !viewerRef.current) return
      userDrivingRef.current = true
      onPoseChangeRef.current?.(readPose(viewerRef.current))
      requestAnimationFrame(() => {
        userDrivingRef.current = false
      })
    }

    // Aplicar pose del lado A en cada frame (más fiable que depender solo de React state).
    const syncFromMain = () => {
      if (cancelled || applyingRef.current || userDrivingRef.current || !viewerRef.current) return
      const pose = syncPoseRef?.current ?? syncPosePropRef.current
      if (!pose) return
      const current = readPose(viewerRef.current)
      if (posesClose(current, pose)) return
      applyingRef.current = true
      applyPose(viewerRef.current, pose)
      queueMicrotask(() => {
        applyingRef.current = false
      })
    }

    viewer.addEventListener('position-updated', emitPose)
    viewer.addEventListener('zoom-updated', emitPose)
    viewer.addEventListener('before-render', syncFromMain)

    const load = async () => {
      if (url === urlRef.current) {
        try {
          viewer.autoSize()
        } catch {
          /* ignore */
        }
        syncFromMain()
        return
      }
      urlRef.current = url
      const pose = syncPoseRef?.current ?? syncPosePropRef.current
      try {
        await viewer.setPanorama(url, {
          transition: false,
          showLoader: false,
          ...(pose
            ? { position: { yaw: pose.yaw, pitch: pose.pitch }, zoom: pose.zoom }
            : {}),
        })
        if (cancelled) return
        try {
          viewer.autoSize()
        } catch {
          /* ignore */
        }
        syncFromMain()
      } catch {
        if (!cancelled) setMode('flat')
      }
    }
    void load()

    const onResize = () => {
      try {
        viewerRef.current?.autoSize()
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('resize', onResize)
    const t = window.setTimeout(onResize, 100)
    const t2 = window.setTimeout(onResize, 400)

    return () => {
      cancelled = true
      window.clearTimeout(t)
      window.clearTimeout(t2)
      window.removeEventListener('resize', onResize)
      viewer.removeEventListener('position-updated', emitPose)
      viewer.removeEventListener('zoom-updated', emitPose)
      viewer.removeEventListener('before-render', syncFromMain)
    }
  }, [mode, url, syncPoseRef])

  // También reaccionar a cambios de syncPose por si no hay ref.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || mode !== 'pano' || !syncPose) return
    if (applyingRef.current) return
    const current = readPose(viewer)
    if (posesClose(current, syncPose)) return
    applyingRef.current = true
    applyPose(viewer, syncPose)
    applyingRef.current = false
  }, [syncPose, mode])

  useEffect(() => {
    return () => {
      viewerRef.current?.destroy()
      viewerRef.current = null
      urlRef.current = null
    }
  }, [])

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-[#111]', className)}>
      {mode === 'pano' ? (
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      ) : null}

      {mode === 'flat' && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
          onError={() => setMode('error')}
        />
      ) : null}

      {mode === 'empty' ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/50">
          Sin tour 360 para comparar
        </div>
      ) : null}

      {mode === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/50">
          No se pudo cargar el 360
        </div>
      ) : null}
    </div>
  )
}
