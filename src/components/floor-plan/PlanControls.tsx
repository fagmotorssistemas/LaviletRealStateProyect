'use client'

import { Minus, Plus, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

type PlanControlsProps = {
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  analyzing?: boolean
  onAnalyze?: () => void
  canAnalyze?: boolean
  editMode?: boolean
  onToggleEdit?: () => void
  canEdit?: boolean
}

export function PlanControls({
  onZoomIn,
  onZoomOut,
  onReset,
  analyzing,
  onAnalyze,
  canAnalyze,
  editMode,
  onToggleEdit,
  canEdit,
}: PlanControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onZoomOut}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#2B1A18] ring-1 ring-[#2B1A18]/12"
        aria-label="Zoom out"
      >
        <Minus size={16} />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#2B1A18] ring-1 ring-[#2B1A18]/12"
        aria-label="Zoom in"
      >
        <Plus size={16} />
      </button>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-semibold tracking-wide text-[#2B1A18] uppercase ring-1 ring-[#2B1A18]/12"
      >
        <RotateCcw size={14} />
        Reset
      </button>
      {onToggleEdit ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={onToggleEdit}
          className={cn(
            'inline-flex h-9 items-center rounded-xl px-3 text-xs font-semibold tracking-wide uppercase ring-1',
            editMode
              ? 'bg-[#1a2744] text-white ring-[#1a2744]'
              : 'bg-white text-[#2B1A18] ring-[#2B1A18]/12',
            !canEdit && 'opacity-50',
          )}
        >
          {editMode ? 'Editando' : 'Editar'}
        </button>
      ) : null}
      {onAnalyze ? (
        <button
          type="button"
          disabled={!canAnalyze || analyzing}
          onClick={onAnalyze}
          className="ml-auto inline-flex h-9 items-center rounded-xl bg-[#2B1A18] px-4 text-xs font-semibold tracking-[0.12em] text-white uppercase disabled:opacity-50"
        >
          {analyzing ? 'Analizando…' : 'Analizar plano'}
        </button>
      ) : null}
    </div>
  )
}
