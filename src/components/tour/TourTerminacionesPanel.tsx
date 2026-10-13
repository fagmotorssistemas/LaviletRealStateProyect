'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, SwatchBook, X } from 'lucide-react'
import type { TourLightMode } from '@/types/tour'
import { cn } from '@/lib/utils'

export type TerminacionOption = {
  slug: string
  name: string
}

export type TerminacionRoomOption = {
  slug: string
  label: string
}

type TourTerminacionesPanelProps = {
  open: boolean
  onClose: () => void
  rooms: TerminacionRoomOption[]
  room: string
  onRoomChange: (slug: string) => void
  finishes: TerminacionOption[]
  finish: string
  onFinishChange: (slug: string) => void
  light: TourLightMode
  onLightChange: (light: TourLightMode) => void
  contained?: boolean
}

export function TourTerminacionesPanel({
  open,
  onClose,
  rooms,
  room,
  onRoomChange,
  finishes,
  finish,
  onFinishChange,
  light,
  onLightChange,
  contained = false,
}: TourTerminacionesPanelProps) {
  const { t } = useTourLanguage()

  const [roomOpen, setRoomOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const currentRoom = useMemo(
    () => rooms.find((item) => item.slug === room) ?? rooms[0] ?? null,
    [rooms, room],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!roomOpen) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setRoomOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [roomOpen])

  if (!open) return null

  return (
    <div
      ref={rootRef}
      className={cn(
        'pointer-events-auto z-[140] flex w-[min(100%-1rem,16rem)] flex-col rounded-[1.75rem] border border-[#bda27e]/40 bg-[#f7f3ee] shadow-[0_16px_48px_rgba(41,37,30,0.20)]',
        contained
          ? 'absolute top-[calc(4.5rem+env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] bottom-auto max-h-[min(78%,32rem)]'
          : 'fixed top-[calc(4.5rem+env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] bottom-auto max-h-[min(78dvh,32rem)]',
      )}
      role="dialog"
      aria-label={t("Terminaciones")}
    >
      <div className="border-b border-[#bda27e]/35 px-3 pt-3 pb-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#8e7654] uppercase">{t("Ambiente")}</p>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#bda27e]/50 text-[#8e7654] transition-colors hover:bg-[#eae3d8] focus-visible:outline-2 focus-visible:outline-[#8e7654]"
            aria-label={t("Cerrar")}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="relative mt-2">
            <button
              type="button"
              onClick={() => setRoomOpen((value) => !value)}
              className="flex h-10 w-full items-center justify-between rounded-xl border border-[#bda27e]/50 bg-white/70 px-3 text-left text-sm font-medium text-[#29251e] transition-colors hover:bg-[#eae3d8] focus-visible:outline-2 focus-visible:outline-[#8e7654]"
              aria-expanded={roomOpen}
            >
              <span className="truncate">{t(currentRoom?.label ?? 'Elegir')}</span>
              <ChevronDown
                size={16}
                className={cn('shrink-0 text-[#8e7654] transition-transform', roomOpen && 'rotate-180')}
              />
            </button>
            {roomOpen ? (
              <ul className="absolute z-10 mt-1.5 max-h-48 w-full overflow-y-auto rounded-xl border border-[#bda27e]/50 bg-[#f7f3ee] py-1 shadow-lg">
                {rooms.map((item) => {
                  const active = item.slug === (currentRoom?.slug ?? room)
                  return (
                    <li key={item.slug}>
                      <button
                        type="button"
                        onClick={() => {
                          onRoomChange(item.slug)
                          setRoomOpen(false)
                        }}
                        className={cn(
                          'flex w-full px-4 py-2.5 text-left text-sm transition-colors',
                          active
                            ? 'bg-[#ded3c1] font-semibold text-[#29251e]'
                            : 'text-[#756044] hover:bg-[#eae3d8]',
                        )}
                      >
                        {t(item.label)}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
        <div className={cn(finishes.length > 1 && 'mb-3')}>
          <div
            role="group"
            aria-label={t("Día")}
            className="grid w-full grid-cols-2 gap-1 rounded-full border border-[#bda27e]/40 bg-[#eae3d8] p-1"
          >
            {([
              ['dia', 'Día'],
              ['noche', 'Noche'],
            ] as const).map(([value, label]) => {
              const active = light === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onLightChange(value)}
                  className={cn(
                    'h-9 w-full rounded-full text-[11px] font-semibold tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-[#8e7654]',
                    active ? 'bg-[#29251e] text-[#f7f3ee]' : 'text-[#756044] hover:text-[#29251e]',
                  )}
                >
                  {t(label)}
                </button>
              )
            })}
          </div>
        </div>

        {finishes.length > 1 ? (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('Terminaciones')}>
            {finishes.map((item) => {
              const active = item.slug === finish
              return (
                <button
                  key={item.slug}
                  type="button"
                  onClick={() => onFinishChange(item.slug)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#8e7654]',
                    active
                      ? 'border-[#8e7654] bg-[#ded3c1] text-[#29251e]'
                      : 'border-[#bda27e]/50 bg-white/70 text-[#756044] hover:border-[#bda27e] hover:text-[#29251e]',
                  )}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eae3d8] text-[#8e7654]">
                    <SwatchBook size={12} strokeWidth={1.75} />
                  </span>
                  <span>{t(item.name)}</span>
                  {active ? <Check size={11} strokeWidth={2.5} /> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
