'use client'

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { Reply } from 'lucide-react'
import { CompareSidePano, type ComparePanoPose } from '@/components/tour/CompareSidePano'
import { finishSwatchStyle } from '@/lib/tour/finishSwatch'
import { cn } from '@/lib/utils'

type FinishBadge = {
  slug: string
  name: string
  swatchUrl?: string | null
}

type TourFinishCompareOverlayProps = {
  left: FinishBadge
  right: FinishBadge
  rightPanoUrl: string | null
  split: number
  onSplitChange: (split: number) => void
  onClose: () => void
  syncPose?: ComparePanoPose | null
  syncPoseRef?: MutableRefObject<ComparePanoPose | null>
  onPoseChange?: (pose: ComparePanoPose) => void
  remapTouch?: boolean
}

function FinishChip({ item, className }: { item: FinishBadge; className?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none inline-flex items-center gap-2 rounded-full bg-white/92 px-2.5 py-1.5 text-[12px] font-semibold text-[#1a2744] shadow-md backdrop-blur-sm',
        className,
      )}
    >
      <span
        className="h-5 w-5 shrink-0 overflow-hidden rounded-full ring-1 ring-black/10"
        style={
          item.swatchUrl
            ? undefined
            : { background: finishSwatchStyle(item.slug, item.name) }
        }
      >
        {item.swatchUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.swatchUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </span>
      {item.name}
    </div>
  )
}

/** Split de dos terminaciones sobre el tour (lado A = PSV principal). */
export function TourFinishCompareOverlay({
  left,
  right,
  rightPanoUrl,
  split,
  onSplitChange,
  onClose,
  syncPose = null,
  syncPoseRef,
  onPoseChange,
  remapTouch = false,
}: TourFinishCompareOverlayProps) {
  const dragRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const splitClamped = Math.min(88, Math.max(12, split))

  const setSplitFromClientX = useCallback(
    (clientX: number) => {
      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      if (rect.width <= 0) return
      onSplitChange(Math.min(88, Math.max(12, ((clientX - rect.left) / rect.width) * 100)))
    },
    [onSplitChange],
  )

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragRef.current) return
      setSplitFromClientX(event.clientX)
    }
    const onUp = () => {
      dragRef.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [setSplitFromClientX])

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-[25]">
      <div
        className="pointer-events-auto absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${splitClamped}%)` }}
      >
        <CompareSidePano
          key={rightPanoUrl ?? 'empty'}
          url={rightPanoUrl}
          className="h-full w-full bg-[#111]"
          syncPose={syncPose}
          syncPoseRef={syncPoseRef}
          onPoseChange={onPoseChange}
          remapTouch={remapTouch}
        />
      </div>

      <div className="pointer-events-none absolute top-3 left-3 z-[32] sm:top-4 sm:left-4">
        <FinishChip item={left} />
      </div>
      <div className="pointer-events-none absolute top-3 right-3 z-[32] sm:top-4 sm:right-[min(100%,21rem)] sm:mr-3">
        <FinishChip item={right} />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="pointer-events-auto absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] z-[34] flex h-11 items-center gap-2 rounded-full bg-[#14110e] px-4 text-[11px] font-semibold tracking-[0.1em] text-white uppercase shadow-[0_4px_16px_rgba(0,0,0,0.4)] ring-1 ring-white/15 transition-transform hover:scale-[1.03]"
        aria-label="Salir de comparación"
        title="Salir de comparación"
      >
        <Reply size={16} strokeWidth={2} className="-scale-x-100" />
        Volver
      </button>

      <div
        role="slider"
        aria-valuemin={12}
        aria-valuemax={88}
        aria-valuenow={Math.round(splitClamped)}
        aria-label="Comparar terminaciones"
        tabIndex={0}
        className="pointer-events-auto absolute top-0 bottom-0 z-[30] w-8 -translate-x-1/2 cursor-ew-resize touch-none"
        style={{ left: `${splitClamped}%` }}
        onPointerDown={(event) => {
          event.preventDefault()
          dragRef.current = true
          setSplitFromClientX(event.clientX)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') onSplitChange(Math.max(12, splitClamped - 2))
          if (event.key === 'ArrowRight') onSplitChange(Math.min(88, splitClamped + 2))
          if (event.key === 'Home') onSplitChange(50)
        }}
        onDoubleClick={() => onSplitChange(50)}
      >
        <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-white shadow-[0_0_12px_rgba(0,0,0,0.35)]" />
        <div className="absolute top-1/2 left-1/2 flex h-11 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_4px_18px_rgba(0,0,0,0.28)] ring-1 ring-black/10">
          <span className="flex gap-[3px]">
            <span className="h-3.5 w-[2px] rounded-full bg-[#9ca3af]" />
            <span className="h-3.5 w-[2px] rounded-full bg-[#9ca3af]" />
          </span>
        </div>
      </div>
    </div>
  )
}
