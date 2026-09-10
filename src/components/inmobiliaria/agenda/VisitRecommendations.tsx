import { CalendarCheck, Check, RefreshCw } from 'lucide-react'
import type { VisitSchedulingOptions, VisitTimeSlot } from '@/types/inmobiliaria'
import { formatAgendaDateTime } from '@/lib/inmobiliaria/agendaTime'

export function VisitRecommendations({ options, loading, error, disabled, selectedStart, onSelect, onReload }: {
  options: VisitSchedulingOptions | null; loading: boolean; error: string; disabled: boolean; selectedStart: string
  onSelect: (slot: VisitTimeSlot) => void; onReload: () => void
}) {
  return <section aria-label="Horarios recomendados" className="rounded-2xl border border-[#dfe5d5] bg-[#f6f8f1] p-4">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[#526247]"><CalendarCheck size={17} />Horarios disponibles</h3>
      <button type="button" onClick={onReload} disabled={disabled || loading} aria-label="Actualizar horarios disponibles" className="rounded-lg p-2 text-[#7e896d] hover:bg-white disabled:opacity-40"><RefreshCw size={14} /></button>
    </div>
    <p className="mt-1 text-xs leading-relaxed text-[#858e78]">Según la agenda del asesor. Elige uno y revisa la propuesta antes de enviarla.</p>
    {loading ? <p role="status" className="py-5 text-center text-sm text-[#7e896d]">Buscando espacios disponibles…</p>
      : error ? <p role="alert" className="mt-3 text-sm text-[#966543]">{error}</p>
        : !options?.slots.length ? <p className="mt-3 text-sm text-[#7e896d]">No encontramos espacios disponibles en estas fechas. Prueba otro día o solicita una reasignación.</p>
          : <div className="mt-3 grid max-h-60 gap-2 overflow-y-auto">{options.slots.map((slot, index) => {
            const selected = Date.parse(selectedStart) === Date.parse(slot.start_time)
            return <button type="button" key={slot.start_time} disabled={disabled} aria-pressed={selected} onClick={() => onSelect(slot)} className={`flex w-full min-w-0 flex-col items-start justify-between gap-2 rounded-xl border px-3 py-3 text-left transition sm:flex-row sm:items-center sm:gap-3 focus-visible:outline-2 focus-visible:outline-[#787D62] ${selected ? 'border-[#87976e] bg-white ring-1 ring-[#87976e]/20' : 'border-[#e2e7d9] bg-white/70 hover:border-[#aebc98] hover:bg-white'}`}>
              <span className="min-w-0"><span className="block text-sm font-medium text-[#48553b]">{formatAgendaDateTime(slot.start_time)}</span><span className="mt-1 block text-[11px] text-[#929b85]">{index === 0 ? 'Recomendado · ' : ''}60 minutos</span></span>
              <span className="flex items-center gap-1 text-xs font-semibold text-[#73815e] sm:shrink-0">{selected ? <><Check size={14} />Seleccionado</> : index === 0 ? 'Aceptar recomendación' : 'Usar horario'}</span>
            </button>
          })}</div>}
  </section>
}
