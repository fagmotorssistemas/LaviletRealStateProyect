import { formatSeconds } from '@/lib/utils'
import type { TourHeatCell } from '@/app/inmobiliaria/usuarios/actions'

function heatColor(ratio: number) {
  const t = Math.max(0, Math.min(1, ratio))
  const start = { r: 247, g: 243, b: 238 }
  const end = { r: 196, g: 92, b: 62 }
  const r = Math.round(start.r + (end.r - start.r) * t)
  const g = Math.round(start.g + (end.g - start.g) * t)
  const b = Math.round(start.b + (end.b - start.b) * t)
  return `rgb(${r} ${g} ${b})`
}

export function TourHeatmap({ cells }: { cells: TourHeatCell[] }) {
  if (cells.length === 0) {
    return <p className="text-sm text-gray-500">Este usuario aún no recorrió el showroom.</p>
  }

  const typologies = [...new Set(cells.map((cell) => cell.typology))]
  const rooms = [...new Set(cells.map((cell) => cell.room))]
  const max = Math.max(...cells.map((cell) => cell.seconds), 1)
  const lookup = new Map(cells.map((cell) => [`${cell.typology}|${cell.room}`, cell]))

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-medium text-gray-500">Tipología</th>
            {rooms.map((room) => (
              <th key={room} className="px-2 py-1 text-center font-medium text-gray-500">
                {room}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {typologies.map((typology) => (
            <tr key={typology}>
              <td className="px-2 py-1 font-semibold text-[#3a3d36]">{typology}</td>
              {rooms.map((room) => {
                const cell = lookup.get(`${typology}|${room}`)
                const seconds = cell?.seconds ?? 0
                const ratio = seconds / max
                return (
                  <td key={room} className="p-0">
                    <div
                      className="flex min-h-14 min-w-20 flex-col items-center justify-center rounded-md px-2 text-center"
                      style={{
                        background: seconds ? heatColor(Math.max(0.18, ratio)) : '#f7f3ee',
                        color: ratio > 0.55 ? '#fff' : '#2B1A18',
                      }}
                      title={cell ? `${typology} · ${room}${cell.unit ? ` · ${cell.unit}` : ''}` : undefined}
                    >
                      <span className="font-semibold">{seconds ? formatSeconds(seconds) : '—'}</span>
                      {cell?.unit && <span className="mt-0.5 text-[10px] opacity-80">{cell.unit}</span>}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
