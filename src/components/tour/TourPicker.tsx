'use client'

type Option = { value: string; label: string }

type TourPickerProps = {
  typologies: Option[]
  typology: string
  onTypologyChange: (code: string) => void
  meta?: string
}

export function TourPicker({ typologies, typology, onTypologyChange, meta }: TourPickerProps) {
  if (typologies.length === 0) return null

  return (
    <div className="w-[min(11.25rem,calc(100vw-4.75rem))] rounded-[4px] bg-black/40 px-1.5 py-1 ring-1 ring-white/12 backdrop-blur-sm">
      <label className="flex min-w-0 flex-col">
        <span className="sr-only">Tipología</span>
        <select
          id="tour-typology"
          value={typology}
          onChange={(e) => onTypologyChange(e.target.value)}
          className="h-8 w-full cursor-pointer appearance-none rounded-[4px] border-0 bg-white/10 px-2 pr-7 text-[12px] font-medium tracking-wide text-white outline-none ring-1 ring-white/15 hover:bg-white/14 focus:ring-white/35"
          style={{
            backgroundImage:
              'linear-gradient(45deg, transparent 50%, rgba(255,255,255,0.55) 50%), linear-gradient(135deg, rgba(255,255,255,0.55) 50%, transparent 50%)',
            backgroundPosition: 'calc(100% - 12px) 13px, calc(100% - 7px) 13px',
            backgroundSize: '5px 5px, 5px 5px',
            backgroundRepeat: 'no-repeat',
          }}
        >
          {typologies.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#2B1A18] text-white">
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {meta ? <p className="mt-0.5 hidden px-0.5 text-[10px] tracking-wide text-white/50 sm:block">{meta}</p> : null}
    </div>
  )
}
