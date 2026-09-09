'use client'

import { useEffect, useRef, useState } from 'react'
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
  /** Pose del otro visor (mismo punto de vista). */
  syncPose?: ComparePanoPose | null
  onPoseChange?: (pose: ComparePanoPose) => void
}

const EPS = 0.0008

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

/** Visor 360 liviano para el lado B (comparador), con sync de cámara. */
export function CompareSidePano({
  url,
  className,
  flatFallback = false,
  syncPose = null,
  onPoseChange,
}: CompareSidePanoProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const urlRef = useRef<string | null>(null)
  const applyingRef = useRef(false)
  const onPoseChangeRef = useRef(onPoseChange)
  onPoseChangeRef.current = onPoseChange
  const syncPoseRef = useRef(syncPose)
  syncPoseRef.current = syncPose

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

    if (!viewer) {
      try {
        viewer = new Viewer({
          container,
          navbar: false,
          loadingTxt: '',
          lang: { loading: '' },
          canvasBackground: '#111',
          defaultZoomLvl: syncPoseRef.current?.zoom ?? 0,
          defaultYaw: syncPoseRef.current?.yaw,
          defaultPitch: syncPoseRef.current?.pitch,
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
      onPoseChangeRef.current?.(readPose(viewerRef.current))
    }

    viewer.addEventListener('position-updated', emitPose)
    viewer.addEventListener('zoom-updated', emitPose)

    const load = async () => {
      if (url === urlRef.current) {
        try {
          viewer.autoSize()
        } catch {
          /* ignore */
        }
        if (syncPoseRef.current) {
          applyingRef.current = true
          applyPose(viewer, syncPoseRef.current)
          applyingRef.current = false
        }
        return
      }
      urlRef.current = url
      const pose = syncPoseRef.current
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
        if (pose) {
          applyingRef.current = true
          applyPose(viewer, pose)
          applyingRef.current = false
        }
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

    return () => {
      cancelled = true
      window.clearTimeout(t)
      window.removeEventListener('resize', onResize)
      viewer.removeEventListener('position-updated', emitPose)
      viewer.removeEventListener('zoom-updated', emitPose)
    }
  }, [mode, url])

  // Sync desde el visor principal
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || mode !== 'pano' || !syncPose) return
    const current = readPose(viewer)
    if (posesClose(current, syncPose)) return
    applyingRef.current = true
    applyPose(viewer, syncPose)
    // liberar en el próximo frame para no rebotar el evento
    requestAnimationFrame(() => {
      applyingRef.current = false
    })
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
          Sin tour 360 para este acabado
        </div>
      ) : null}

      {mode === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/50">
          No se pudo cargar el acabado
        </div>
      ) : null}
    </div>
  )
}
