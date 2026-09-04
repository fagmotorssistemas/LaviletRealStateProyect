'use client'

import type { TourRoomDef } from '@/lib/tour/tourRooms'

function slot(index: number, total: number) {
  const t = total <= 1 ? 0.5 : index / (total - 1)
  const spread = Math.min(0.78, 0.12 + total * 0.07)
  const x = 0.5 - spread / 2 + spread * t
  const y = 0.16 + Math.sin(t * Math.PI) * 0.1
  return { left: `${x * 100}%`, bottom: `${y * 100}%` }
}

export function TourHotspotLayer({
  targets,
  onSelect,
}: {
  targets: TourRoomDef[]
  onSelect: (slug: string) => void
}) {
  if (targets.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[15]">
      {targets.map((item, index) => {
        const pos = slot(index, targets.length)
        return (
          <button
            key={item.slug}
            type="button"
            className="tour-hotspot pointer-events-auto absolute"
            style={{ left: pos.left, bottom: pos.bottom, transform: 'translateX(-50%)' }}
            onClick={() => onSelect(item.slug)}
          >
            <span className="tour-hotspot-disc">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M7.5 9.5 12 14.5l4.5-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="tour-hotspot-label">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
