'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { finishSwatchStyle } from '@/lib/tour/finishSwatch'
import { cn } from '@/lib/utils'

export type TerminacionOption = {
  slug: string
  name: string
  swatchUrl?: string | null
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
  /** Comparación de terminaciones (no unidades). */
  compare: boolean
  onCompareChange: (value: boolean) => void
  finishLeft: string
  finishRight: string
  onFinishLeftChange: (slug: string) => void
  onFinishRightChange: (slug: string) => void
  contained?: boolean
}

function SwatchThumb({
  option,
  size = 'md',
}: {
  option: TerminacionOption
  size?: 'sm' | 'md'
}) {
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  return (
    <span
      className={cn('shrink-0 overflow-hidden rounded-md ring-1 ring-black/10', dim)}
      style={
        option.swatchUrl ? undefined : { background: finishSwatchStyle(option.slug, option.name) }
      }
    >
      {option.swatchUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={option.swatchUrl} alt="" className="h-full w-full object-cover" />
      ) : null}
    </span>
  )
}

function FinishSidePicker({
  label,
  value,
  finishes,
  onChange,
}: {
  label: string
  value: string
  finishes: TerminacionOption[]
  onChange: (slug: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = finishes.find((item) => item.slug === value) ?? finishes[0] ?? null

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  if (!current) return null

  return (
    <div ref={rootRef} className="relative">
      <p className="mb-1.5 text-[11px] font-medium text-[#6b7280]">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-full items-center gap-2.5 rounded-2xl border border-[#e5e7eb] bg-white px-3 text-left transition-colors hover:bg-[#f7f8fa]"
        aria-expanded={open}
      >
        <SwatchThumb option={current} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#1a2744]">
          {current.name}
        </span>
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-[#6b7280] transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <ul className="absolute z-20 mt-1.5 max-h-52 w-full overflow-y-auto rounded-xl border border-[#e5e7eb] bg-white py-1 shadow-lg">
          {finishes.map((item) => {
            const active = item.slug === current.slug
            return (
              <li key={item.slug}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.slug)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors',
                    active
                      ? 'bg-[#f0f4ff] font-semibold text-[#1a2744]'
                      : 'text-[#4b5563] hover:bg-[#f7f8fa]',
                  )}
                >
                  <SwatchThumb option={item} size="sm" />
                  {item.name}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
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
  compare,
  onCompareChange,
  finishLeft,
  finishRight,
  onFinishLeftChange,
  onFinishRightChange,
  contained = false,
}: TourTerminacionesPanelProps) {
  const [roomOpen, setRoomOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const currentRoom = useMemo(
    () => rooms.find((item) => item.slug === room) ?? rooms[0] ?? null,
    [rooms, room],
  )

  useEffect(() => {
    if (!open) {
      setRoomOpen(false)
      return
    }
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
        'pointer-events-auto z-[38] flex w-[min(100%-1.5rem,19.5rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_16px_48px_rgba(15,23,42,0.22)]',
        contained
          ? 'absolute top-3 right-3 bottom-auto max-h-[min(82%,34rem)] sm:top-4 sm:right-4'
          : 'fixed top-3 right-3 bottom-auto max-h-[min(82dvh,34rem)] sm:top-5 sm:right-5',
      )}
      role="dialog"
      aria-label="Elección de terminación"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-1">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-[12px] font-semibold text-[#1a2744]">Habitación</p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setRoomOpen((value) => !value)}
              className="flex h-11 w-full items-center justify-between rounded-xl border border-[#e5e7eb] bg-white px-3.5 text-left text-sm font-medium text-[#1a2744] transition-colors hover:bg-[#f7f8fa]"
              aria-expanded={roomOpen}
            >
              <span className="truncate">{currentRoom?.label ?? 'Elegir'}</span>
              <ChevronDown
                size={16}
                className={cn('shrink-0 text-[#6b7280] transition-transform', roomOpen && 'rotate-180')}
              />
            </button>
            {roomOpen ? (
              <ul className="absolute z-10 mt-1.5 max-h-48 w-full overflow-y-auto rounded-xl border border-[#e5e7eb] bg-white py-1 shadow-lg">
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
                            ? 'bg-[#f0f4ff] font-semibold text-[#1a2744]'
                            : 'text-[#4b5563] hover:bg-[#f7f8fa]',
                        )}
                      >
                        {item.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6b7280] transition-colors hover:bg-[#f3f4f6]"
          aria-label="Cerrar"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[12px] font-semibold text-[#1a2744]">Elección de terminación</p>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <span className="text-[11px] font-medium text-[#6b7280]">Comparar</span>
            <button
              type="button"
              role="switch"
              aria-checked={compare}
              onClick={() => onCompareChange(!compare)}
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors',
                compare ? 'bg-[#1a2744]' : 'bg-[#d1d5db]',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                  compare && 'translate-x-5',
                )}
              />
            </button>
          </label>
        </div>

        {finishes.length === 0 ? (
          <p className="rounded-xl bg-[#f7f8fa] px-3 py-6 text-center text-sm text-[#9ca3af]">
            Todavía no hay terminaciones cargadas.
          </p>
        ) : compare ? (
          <div className="space-y-3">
            <FinishSidePicker
              label="Izquierda"
              value={finishLeft}
              finishes={finishes}
              onChange={onFinishLeftChange}
            />
            <FinishSidePicker
              label="Derecha"
              value={finishRight}
              finishes={finishes}
              onChange={onFinishRightChange}
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {finishes.map((item) => {
              const active = item.slug === finish
              return (
                <button
                  key={item.slug}
                  type="button"
                  onClick={() => onFinishChange(item.slug)}
                  className="group flex flex-col items-center gap-1.5 text-center"
                >
                  <span className="relative block aspect-square w-full overflow-hidden rounded-xl ring-1 ring-[#e5e7eb] transition group-hover:ring-[#c7ccd6]">
                    {item.swatchUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.swatchUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <span
                        className="absolute inset-0"
                        style={{ background: finishSwatchStyle(item.slug, item.name) }}
                      />
                    )}
                    {active ? (
                      <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#1a2744] text-white shadow">
                        <Check size={12} strokeWidth={2.5} />
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      'text-[11px] font-medium',
                      active ? 'text-[#1a2744]' : 'text-[#6b7280]',
                    )}
                  >
                    {item.name}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
