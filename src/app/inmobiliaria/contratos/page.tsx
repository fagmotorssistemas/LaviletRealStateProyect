'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, Plus, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listContracts } from '@/services/inmobiliaria.service'
import { CreateContractModal } from '@/components/inmobiliaria/contracts/CreateContractModal'
import { ContractDetailModal } from '@/components/inmobiliaria/contracts/ContractDetailModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Pagination } from '@/components/ui/Pagination'
import { formatDate } from '@/lib/utils'
import type { Contract, ContractStatus } from '@/types/inmobiliaria'

const contractStatusOptions = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'firmado', label: 'Firmado' },
  { value: 'anulado', label: 'Anulado' },
]

export default function ContratosPage() {
  const { supabase, user } = useAuth()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const pageSize = 25
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    if (!user) {
      setContracts([])
      setTotal(0)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const tenantIds = await getAccessibleTenantIds(supabase)
      if (!tenantIds.length) {
        setContracts([])
        setTotal(0)
        return
      }
      setTenantId(tenantIds[0])
      const res = await listContracts(supabase, {
        tenantId: tenantIds[0],
        tenantIds,
        status: (statusFilter || undefined) as ContractStatus | undefined,
        search: search || undefined,
        page,
        pageSize,
      })
      setContracts(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'No se pudieron cargar los contratos')
      setContracts([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, user, statusFilter, search, page, pageSize])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Documentación comercial"
        title="Contratos"
        description={
          <>
            Contratos y anticipos
            {total > 0 && <span className="text-[#9a7d55]"> · {total} registros</span>}
          </>
        }
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} className="mr-2" />
            Nuevo contrato
          </Button>
        }
      />

      <InmobiliariaFiltersToolbar
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Buscar contrato..."
        resultsTotal={total}
        hasActiveFilters={Boolean(search || statusFilter)}
        onReset={() => {
          setSearch('')
          setStatusFilter('')
          setPage(1)
        }}
      >
        <Select
          label="Estado"
          options={contractStatusOptions}
          placeholder="Todos"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setPage(1)
          }}
          className="w-full"
        />
      </InmobiliariaFiltersToolbar>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : contracts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={total === 0 ? 'No hay contratos' : 'No hay resultados'}
          description={total === 0 ? 'Los contratos se crearán cuando un lead llegue a la etapa de cierre.' : 'No existen contratos que coincidan con la búsqueda en esta página.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Nro. Contrato</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Lead</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Anticipo</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Fecha Anticipo</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Contrato</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Comprobante</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Creado</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedContract(c)
                      setDetailOpen(true)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedContract(c)
                        setDetailOpen(true)
                      }
                    }}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{c.contract_number ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{c.lead?.name ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} type="contract" /></td>
                    <td className="px-4 py-3 text-right"><PriceText value={c.anticipo_amount} size="sm" /></td>
                    <td className="px-4 py-3 text-gray-600">{c.anticipo_date ? formatDate(c.anticipo_date) : '—'}</td>
                    <td className="px-4 py-3 text-left">
                      {c.pdf_url ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Abrir contrato"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(c.pdf_url ?? undefined, '_blank', 'noopener,noreferrer')
                          }}
                        >
                          <FileText size={16} />
                        </Button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-left">
                      {c.anticipo_proof_url ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Abrir comprobante del anticipo"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(c.anticipo_proof_url ?? undefined, '_blank', 'noopener,noreferrer')
                          }}
                        >
                          <Receipt size={16} />
                        </Button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <div className="pt-4">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
            </div>
          )}
        </>
      )}

      <ContractDetailModal
        contract={selectedContract}
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          setSelectedContract(null)
        }}
        tenantId={tenantId}
        onContractUpdated={load}
      />

      <CreateContractModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
        tenantId={tenantId}
      />
    </div>
  )
}
