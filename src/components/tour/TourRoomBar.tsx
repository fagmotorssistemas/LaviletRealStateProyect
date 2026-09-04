'use client'

import { cn } from '@/lib/utils'
import type { TourRoomDef } from '@/lib/tour/tourRooms'

export function TourRoomBar({
  rooms,
  current,
  panoBySlug,
  onSelect,
}: {
  rooms: TourRoomDef[]
  current: string
  panoBySlug: Record<string, string | null | undefined>
  onSelect: (slug: string) => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-1.5 rounded-[4px] bg-black/55 p-2 backdrop-blur-sm">
      {rooms.map((item) => {
        const hasPano = Boolean(panoBySlug[item.slug])
        const active = current === item.slug
        return (
          <button
            key={item.slug}
            type="button"
            onClick={() => onSelect(item.slug)}
            className={cn(
              'h-10 min-w-[4.5rem] cursor-pointer rounded-[4px] px-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors',
              active ? 'bg-[#787D62] text-white' : 'bg-white/10 text-white/80 hover:bg-white/16',
            )}
          >
            {item.label}
            {!hasPano ? <span className="ml-1 text-white/35">·</span> : null}
          </button>
        )
      })}
    </div>
  )
}
