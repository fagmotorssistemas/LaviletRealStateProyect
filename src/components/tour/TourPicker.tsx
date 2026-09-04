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
    <div className="w-[min(13rem,calc(100vw-4.75rem))] border border-white/20 bg-[#14110e]/42 px-3 py-2 backdrop-blur-[10px]">
      <label className="flex min-w-0 flex-col">
        <span className="text-[9px] font-medium tracking-[0.22em] text-[#BDA27E] uppercase">
          Tipología
        </span>
        <select
          id="tour-typology"
          value={typology}
          onChange={(e) => onTypologyChange(e.target.value)}
          className="mt-1 h-7 w-full cursor-pointer appearance-none border-0 bg-transparent pr-6 text-[12px] font-medium tracking-[0.04em] text-white outline-none"
          style={{
            backgroundImage:
              'linear-gradient(45deg, transparent 50%, rgba(189,162,126,0.9) 50%), linear-gradient(135deg, rgba(189,162,126,0.9) 50%, transparent 50%)',
            backgroundPosition: 'calc(100% - 4px) 11px, calc(100% + 1px) 11px',
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
      {meta ? (
        <p className="mt-1 hidden border-t border-white/10 pt-1.5 text-[10px] tracking-[0.14em] text-white/50 sm:block">
          {meta}
        </p>
      ) : null}
    </div>
  )
}
