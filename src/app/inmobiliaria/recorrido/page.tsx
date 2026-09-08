'use client'

import { useCallback, useEffect, useState } from 'react'
import { Compass, MapPin, Clock3 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getTourRecorridoAction,
  listTourRecorridosAction,
  type TourRecorridoDetail,
  type TourRecorridoRow,
} from '@/app/inmobiliaria/recorrido/actions'
import { TourRecorridoTimeline } from '@/components/inmobiliaria/recorrido/TourRecorridoTimeline'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { formatDateTime, formatSeconds } from '@/lib/utils'

type IdentifiedFilter = 'all' | 'yes' | 'no'

export default function RecorridoPage() {
  const [rows, setRows] = useState<TourRecorridoRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [identified, setIdentified] = useState<IdentifiedFilter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<TourRecorridoDetail | null>(null)
  const pageSize = 15

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listTourRecorridosAction({
      page,
      pageSize,
      identified,
      search: search.trim() || undefined,
    })
    setRows(result.data)
    setTotal(result.total)
    if (result.error) toast.error(result.error)
    setLoading(false)
  }, [page, identified, search])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (row: TourRecorridoRow) => {
    try {
      const detail = await getTourRecorridoAction(row.sessionId)
      setSelected(detail)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo abrir la sesión')
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Admin"
        title="Recorrido 360°"
        description={
          <>
            Sesiones del showroom, tiempo por ambiente y datos del lead
            {total > 0 && <span className="text-[#9a7d55]"> · {total} visitas</span>}
          </>
        }
      />

      <InmobiliariaFiltersToolbar
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Buscar visitante, ciudad u origen..."
        resultsTotal={total}
        hasActiveFilters={Boolean(search || identified !== 'all')}
        onReset={() => {
          setSearch('')
          setIdentified('all')
          setPage(1)
        }}
      >
        <Select
          label="Visitantes"
          value={identified}
          onChange={(event) => {
            setIdentified(event.target.value as IdentifiedFilter)
            setPage(1)
          }}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'yes', label: 'Con datos' },
            { value: 'no', label: 'Anónimos' },
          ]}
          placeholder="Todos"
        />
      </InmobiliariaFiltersToolbar>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={Compass}
          title="Aún no hay recorridos"
          description="Cuando alguien entre al showroom 360°, la sesión aparece aquí con el tiempo y los ambientes."
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <button
                key={row.sessionId}
                type="button"
                onClick={() => void openDetail(row)}
                className="w-full rounded-2xl bg-white p-4 text-left transition-colors hover:bg-[#f7f7f3]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#3a3d36]">
                      {row.leadName || 'Visitante anónimo'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[#6e716b]">
                      {row.leadPhone || row.leadEmail || 'Sin identificar'}
                    </p>
                  </div>
                  <span className="crm-num shrink-0 rounded-full bg-[#f4f4ef] px-2.5 py-1 text-[11px] font-semibold text-[#3a3d36]">
                    {formatSeconds(row.totalSeconds)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-[#6e716b]">
                  <p className="flex items-center gap-1.5">
                    <Clock3 size={12} className="shrink-0" />
                    <span className="truncate">{formatDateTime(row.startedAt)}</span>
                  </p>
                  <p className="truncate">Ambiente · {row.topRoom ?? '—'}</p>
                  <p className="flex items-center gap-1.5">
                    <MapPin size={12} className="shrink-0" />
                    <span className="truncate">
                      {[row.firstUtmSource ?? row.utmSource, row.city].filter(Boolean).join(' · ') || 'Sin origen'}
                    </span>
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl bg-white md:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[18%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.14em] text-[#6e716b] uppercase">
                    Visitante
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold tracking-[0.14em] text-[#6e716b] uppercase">
                    Entrada
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold tracking-[0.14em] text-[#6e716b] uppercase">
                    Tiempo
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold tracking-[0.14em] text-[#6e716b] uppercase">
                    Ambiente
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold tracking-[0.14em] text-[#6e716b] uppercase">
                    Origen
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold tracking-[0.14em] text-[#6e716b] uppercase">
                    Ciudad
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.sessionId}
                    className="cursor-pointer border-b border-[#2B1A18]/05 last:border-b-0 hover:bg-[#f7f7f3]/80"
                    onClick={() => void openDetail(row)}
                  >
                    <td className="px-4 py-3.5 text-left align-middle">
                      <p className="truncate font-semibold text-[#3a3d36]">
                        {row.leadName || 'Visitante anónimo'}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[#6e716b]">
                        {row.leadPhone || row.leadEmail || 'Sin identificar'}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 text-center align-middle text-[#555850]">
                      {formatDateTime(row.startedAt)}
                    </td>
                    <td className="px-4 py-3.5 text-center align-middle">
                      <span className="crm-num inline-flex min-w-[4.5rem] items-center justify-center rounded-full bg-[#f4f4ef] px-2.5 py-1 text-[12px] font-semibold text-[#3a3d36]">
                        {formatSeconds(row.totalSeconds)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center align-middle text-[#555850]">
                      <span className="block truncate">{row.topRoom ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3.5 text-center align-middle text-[#555850]">
                      <span className="block truncate">{row.firstUtmSource ?? row.utmSource ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3.5 text-center align-middle text-[#555850]">
                      <span className="block truncate">{row.city ?? '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-2">
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        </>
      )}

      {selected && (
        <Modal
          isOpen
          onClose={() => setSelected(null)}
          title={selected.leadName || 'Visitante anónimo'}
          size="xl"
        >
          <TourRecorridoTimeline detail={selected} />
        </Modal>
      )}
    </div>
  )
}
