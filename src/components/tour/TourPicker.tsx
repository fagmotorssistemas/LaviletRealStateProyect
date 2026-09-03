'use client'

type Option = { value: string; label: string }

type TourPickerProps = {
  typologies: Option[]
  typology: string
  floors: Option[]
  units: Option[]
  floor: string
  unitId: string
  onTypologyChange: (code: string) => void
  onFloorChange: (floor: string) => void
  onUnitChange: (unitId: string) => void
}

function TourSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[9px] font-semibold tracking-[0.16em] text-white/45 uppercase">{label}</span>
      <select
        id={id}
        value={value}
        disabled={disabled || options.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer appearance-none rounded-[4px] border-0 bg-white/10 px-2.5 pr-7 text-[12px] font-medium tracking-wide text-white outline-none ring-1 ring-white/15 hover:bg-white/14 focus:ring-white/35 disabled:cursor-default disabled:opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(45deg, transparent 50%, rgba(255,255,255,0.55) 50%), linear-gradient(135deg, rgba(255,255,255,0.55) 50%, transparent 50%)',
          backgroundPosition: 'calc(100% - 14px) 16px, calc(100% - 9px) 16px',
          backgroundSize: '5px 5px, 5px 5px',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {options.length === 0 ? <option value="">Sin opciones</option> : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[#2B1A18] text-white">
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function TourPicker({
  typologies,
  typology,
  floors,
  units,
  floor,
  unitId,
  onTypologyChange,
  onFloorChange,
  onUnitChange,
}: TourPickerProps) {
  return (
    <div className="grid w-[16.5rem] grid-cols-2 gap-2 rounded-[4px] bg-black/55 p-2 ring-1 ring-white/15 backdrop-blur-sm">
      {typologies.length > 0 && (
        <div className="col-span-2">
          <TourSelect
            id="tour-typology"
            label="Tipología"
            value={typology}
            options={typologies}
            onChange={onTypologyChange}
          />
        </div>
      )}
      <TourSelect
        id="tour-floor"
        label="Piso"
        value={floor}
        options={floors}
        onChange={onFloorChange}
      />
      <TourSelect
        id="tour-unit"
        label="Departamento"
        value={unitId}
        options={units}
        onChange={onUnitChange}
        disabled={!floor}
      />
    </div>
  )
}
