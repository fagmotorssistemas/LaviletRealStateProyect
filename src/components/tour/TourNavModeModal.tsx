'use client'

import { Compass, Hand, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TourNavMode = 'gyro' | 'finger'

type TourNavModeModalProps = {
  open: boolean
  contained?: boolean
  onChoose: (mode: TourNavMode) => void
  onClose: () => void
}

export function TourNavModeModal({
  open,
  contained = false,
  onChoose,
  onClose,
}: TourNavModeModalProps) {
  if (!open) return null

  return (
    <div
      className={cn(
        'z-[88] flex items-end justify-center p-3 sm:items-center',
        contained ? 'absolute inset-0' : 'fixed inset-0',
      )}
    >
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative z-[1] w-full max-w-[21rem] overflow-hidden rounded-2xl border border-white/20 bg-[#14110e]/94 p-4 text-[#f7f3ee] shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-[#BDA27E] uppercase">
              Tour 360°
            </p>
            <p className="mt-1.5 text-sm leading-snug text-[#f7f3ee]/90">
              ¿Cómo quiere moverse por el departamento?
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#f7f3ee]/70 hover:bg-white/10 hover:text-white"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-2.5">
          <button
            type="button"
            onClick={() => onChoose('gyro')}
            className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/8 px-3.5 py-3 text-left transition-colors hover:border-[#BDA27E]/55 hover:bg-white/12"
          >
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Compass size={18} strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold tracking-[0.08em] uppercase">
                Giroscopio
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-[#f7f3ee]/65">
                Mueva el teléfono para mirar alrededor
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChoose('finger')}
            className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/8 px-3.5 py-3 text-left transition-colors hover:border-[#BDA27E]/55 hover:bg-white/12"
          >
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Hand size={18} strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold tracking-[0.08em] uppercase">
                Con el dedo
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-[#f7f3ee]/65">
                Arrastre la vista con el dedo o el mouse
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
