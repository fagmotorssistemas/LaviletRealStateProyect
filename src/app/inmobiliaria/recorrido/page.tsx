'use client'

import { useCallback, useEffect, useState } from 'react'
import { Compass } from 'lucide-react'
import { toast } from 'sonner'
import {
  getTourRecorridoAction,
  listTourRecorridosAction,
  type TourRecorridoDetail,
  type TourRecorridoRow,
} from '@/app/inmobiliaria/recorrido/actions'
import { TourRecorridoTimeline } from '@/components/inmobiliaria/recorrido/TourRecorridoTimeline'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { formatDateTime, formatSeconds } from '@/lib/utils'

export default function RecorridoPage() {
  const [rows, setRows] = useState<TourRecorridoRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [identified, setIdentified] = useState<'all' | 'yes' | 'no'>('all')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<TourRecorridoDetail | null>(null)
  const pageSize = 15

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listTourRecorridosAction({ page, pageSize, identified })
    setRows(result.data)
    setTotal(result.total)
    if (result.error) toast.error(result.error)
    setLoading(false)
  }, [page, identified])

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

      <div className="max-w-xs">
        <Select
          label="Visitantes"
          value={identified}
          onChange={(event) => {
            setIdentified(event.target.value as 'all' | 'yes' | 'no')
            setPage(1)
          }}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'yes', label: 'Con datos' },
            { value: 'no', label: 'Anónimos' },
          ]}
        />
      </div>

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
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Visitante</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Entrada</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Tiempo</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Ambiente</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Origen</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Ciudad</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.sessionId}
                    className="cursor-pointer border-b border-gray-50 hover:bg-gray-50/50"
                    onClick={() => void openDetail(row)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{row.leadName || 'Visitante anónimo'}</p>
                      <p className="text-xs text-gray-500">{row.leadPhone || row.leadEmail || 'Sin identificar'}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDateTime(row.startedAt)}</td>
                    <td className="px-4 py-3 text-right crm-num font-medium text-gray-900">
                      {formatSeconds(row.totalSeconds)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.topRoom ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{row.firstUtmSource ?? row.utmSource ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{row.city ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
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
