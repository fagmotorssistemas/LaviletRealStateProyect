'use client'

import { useState } from 'react'
import { UserPlus, Plus } from 'lucide-react'
import { useLeads } from '@/hooks/inmobiliaria/useLeads'
import { LeadsList } from '@/components/inmobiliaria/leads/LeadsList'
import { LeadDetailModal } from '@/components/inmobiliaria/leads/LeadDetailModal'
import { CreateLeadModal } from '@/components/inmobiliaria/leads/CreateLeadModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import type { Lead } from '@/types/inmobiliaria'
import { LEAD_STATUS_OPTIONS } from '@/types/inmobiliaria'

export default function LeadsPage() {
  const { leads, isLoading, tenantId, filters, updateFilter, resetFilters, reload, page, pageSize, total, setPage } = useLeads()
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const handleSelect = (lead: Lead) => {
    setSelectedLeadId(lead.id)
    setDetailOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestiona tus prospectos y su avance comercial
            {total > 0 && <span className="ml-2 text-gray-400">• {total} leads</span>}
          </p>
        </div>

        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus size={16} className="mr-2" />
          Nuevo Lead
        </Button>
      </div>

      <div>
        <InmobiliariaFiltersToolbar
          searchValue={filters.search}
          onSearchChange={(value) => updateFilter('search', value)}
          searchPlaceholder="Buscar lead..."
          resultsTotal={total}
          hasActiveFilters={Boolean(filters.search || filters.status || filters.assignedTo)}
          onReset={resetFilters}
        >
          <Select
            options={LEAD_STATUS_OPTIONS}
            placeholder="Todos los estados"
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="w-full sm:w-44"
          />
        </InmobiliariaFiltersToolbar>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : total === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No hay leads"
          description="Aún no se han registrado prospectos. Agrega tu primer lead para comenzar."
        />
      ) : (
        <>
          <LeadsList leads={leads} onSelect={handleSelect} />
          <div className="pt-4">
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        </>
      )}

      <LeadDetailModal
        leadId={selectedLeadId}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        onUpdated={reload}
        tenantId={tenantId}
      />

      <CreateLeadModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        tenantId={tenantId}
      />
    </div>
  )
}
