'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type Option = { value: string; label: string }

type TourPickerProps = {
  typologies: Option[]
  typology: string
  onTypologyChange: (code: string) => void
  meta?: string
}

function shortLabel(label: string) {
  const [code, ...rest] = label.split(' · ')
  const name = rest.join(' · ').trim()
  if (!name || name.length > 28) return { code, name: name ? `${name.slice(0, 26).trim()}…` : '' }
  return { code, name }
}

export function TourPicker({ typologies, typology, onTypologyChange, meta }: TourPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = typologies.find((item) => item.value === typology) ?? typologies[0]
  const shown = current ? shortLabel(current.label) : { code: '—', name: '' }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (typologies.length === 0) return null

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="tour-glass flex h-10 w-full items-center gap-1.5 px-3 text-left"
        aria-expanded={open}
        aria-haspopup="listbox"
        title={[shown.name, meta].filter(Boolean).join(' · ') || undefined}
      >
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium tracking-[0.16em] text-[#f7f3ee] uppercase sm:text-[11px]">
          Tipología {shown.code}
        </span>
        <span className="shrink-0 text-[9px] text-white/45">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="tour-glass absolute top-[calc(100%+6px)] left-0 z-30 max-h-56 w-full overflow-y-auto py-1"
        >
          {typologies.map((opt) => {
            const parts = shortLabel(opt.label)
            const active = opt.value === typology
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onTypologyChange(opt.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full flex-col items-start px-3 py-2 text-left',
                    active ? 'bg-white/12 text-[#f7f3ee]' : 'text-white/75 hover:bg-white/8 hover:text-white',
                  )}
                >
                  <span className="text-[12px] font-medium">{parts.code}</span>
                  {parts.name ? <span className="text-[10px] text-white/45">{parts.name}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
