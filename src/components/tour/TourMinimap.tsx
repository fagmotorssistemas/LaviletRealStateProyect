'use client'

import { cn } from '@/lib/utils'

export type TourMinimapRoom = {
  id: string
  name: string
  x: number
  y: number
  heading: number
}

type TourMinimapProps = {
  rooms: TourMinimapRoom[]
  currentRoom: string
  yaw: number
  onSelectRoom: (roomId: string) => void
}

export function TourMinimap({ rooms, currentRoom, yaw, onSelectRoom }: TourMinimapProps) {
  const current = rooms.find((r) => r.id === currentRoom)
  const rotation = (current?.heading ?? 0) + (yaw * 180) / Math.PI

  return (
    <div
      className="relative h-[7.25rem] w-[7.25rem] overflow-hidden rounded-[4px] bg-black/55 shadow-lg ring-1 ring-white/15 backdrop-blur-sm sm:h-[8.5rem] sm:w-[8.5rem]"
      aria-label="Minimapa"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-1.5 pt-1 text-[9px] font-semibold tracking-[0.16em] text-white/45 uppercase">
        Planta
      </div>

      {rooms.map((room) => {
        const active = room.id === currentRoom
        return (
          <button
            key={room.id}
            type="button"
            title={room.name}
            onClick={() => onSelectRoom(room.id)}
            className={cn(
              'absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform',
              active ? 'h-3.5 w-3.5 bg-[#BDA27E] ring-2 ring-white' : 'h-2.5 w-2.5 bg-white/70 hover:bg-white',
            )}
            style={{ left: `${room.x}%`, top: `${room.y}%` }}
          >
            <span className="sr-only">{room.name}</span>
          </button>
        )
      })}

      {current && (
        <div
          className="pointer-events-none absolute z-[5] h-8 w-8 -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${current.x}%`,
            top: `${current.y}%`,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          }}
        >
          <div className="absolute top-0 left-1/2 h-4 w-3 -translate-x-1/2 bg-[conic-gradient(from_180deg_at_50%_100%,rgba(189,162,126,0.0),rgba(189,162,126,0.55))] [clip-path:polygon(50%_0,100%_100%,0_100%)]" />
        </div>
      )}

      <p className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] font-medium text-white/70">
        {current?.name ?? ''}
      </p>
    </div>
  )
}
