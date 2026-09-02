'use client'

import { useState } from 'react'
import { BarChart3, Plus } from 'lucide-react'
import { useSalesReport } from '@/hooks/inmobiliaria/useSalesReport'
import { SalesClosingsTable } from '@/components/inmobiliaria/sales/SalesClosingsTable'
import { CreateClosingModal } from '@/components/inmobiliaria/sales/CreateClosingModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'

export default function VentasPage() {
  const {
    closings,
    summary,
    projects,
    advisors,
    isLoading,
    tenantId,
    search,
    setSearch,
    projectId,
    setProjectId,
    soldById,
    setSoldById,
    from,
    setFrom,
    to,
    setTo,
    reset,
    reload,
  } = useSalesReport()
  const [createOpen, setCreateOpen] = useState(false)

  const hasFilters = Boolean(search || projectId || soldById || from || to)

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Cierre comercial"
        title="Reporte de ventas"
        description={
          <>
            Cierres registrados: unidad, asesor, precio y fecha
            {summary.count > 0 && (
              <span className="text-[#9a7d55]"> · {summary.count} cierres</span>
            )}
          </>
        }
        actions={
          <Button onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus size={16} className="mr-2" />
            Registrar cierre
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="crm-stat">
          <p className="crm-stat-label">Total vendido</p>
          <div className="crm-stat-value">
            <PriceText value={summary.total} size="lg" />
          </div>
        </div>
        <div className="crm-stat">
          <p className="crm-stat-label">Cierres</p>
          <p className="crm-stat-value">{summary.count}</p>
        </div>
        <div className="crm-stat">
          <p className="crm-stat-label">Ticket promedio</p>
          <div className="crm-stat-value">
            <PriceText value={summary.avg} size="lg" />
          </div>
        </div>
        <div className="crm-stat">
          <p className="crm-stat-label">Descuento vs lista</p>
          <p className="crm-stat-value">
            <PriceText value={summary.discount} size="lg" />
          </p>
        </div>
      </div>

      <InmobiliariaFiltersToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar unidad, cliente, asesor..."
        resultsTotal={closings.length}
        hasActiveFilters={hasFilters}
        onReset={reset}
      >
        <Select
          label="Proyecto"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Todos"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        />
        <Select
          label="Asesor"
          options={advisors.map((a) => ({ value: a.id, label: a.full_name || 'Sin nombre' }))}
          placeholder="Todos"
          value={soldById}
          onChange={(e) => setSoldById(e.target.value)}
        />
        <Input
          id="sales-from"
          label="Desde"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          id="sales-to"
          label="Hasta"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </InmobiliariaFiltersToolbar>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : closings.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No hay cierres de venta"
          description="Registra un cierre para que entre al reporte: unidad, asesor, precio final y fecha."
        />
      ) : (
        <SalesClosingsTable closings={closings} />
      )}

      <CreateClosingModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        tenantId={tenantId}
        projects={projects}
        advisors={advisors}
      />
    </div>
  )
}
