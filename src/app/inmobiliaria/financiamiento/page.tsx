'use client'

import { useState } from 'react'
import { CircleDollarSign, Plus, Wallet, Users, MessageSquareText } from 'lucide-react'
import { useFinancing, type FinancingTab } from '@/hooks/inmobiliaria/useFinancing'
import { CreatePaymentPlanModal } from '@/components/inmobiliaria/financing/CreatePaymentPlanModal'
import { FinancingCotizador } from '@/components/inmobiliaria/financing/FinancingCotizador'
import { CreateAsesoriaModal } from '@/components/inmobiliaria/financing/CreateAsesoriaModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PersonCell } from '@/components/inmobiliaria/shared/PersonCell'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import {
  LEAD_FINANCING_STATUS_OPTIONS,
  FINANCING_TYPE_OPTIONS,
  PAYMENT_PLAN_BALANCE_OPTIONS,
} from '@/types/inmobiliaria'
import { cn } from '@/lib/utils'

const tabs: { id: FinancingTab; label: string }[] = [
  { id: 'solicitudes', label: 'Cotizador' },
  { id: 'planes', label: 'Planes de pago' },
  { id: 'asesorias', label: 'Asesorías' },
  { id: 'interesados', label: 'Leads interesados' },
]

export default function FinanciamientoPage() {
  const {
    tab,
    setTab,
    tenantId,
    projects,
    plans,
    requests,
    asesorias,
    interestedLeads,
    partners,
    isLoading,
    search,
    setSearch,
    projectId,
    setProjectId,
    status,
    setStatus,
    resetFilters,
    reload,
  } = useFinancing()
  const [planOpen, setPlanOpen] = useState(false)
  const [asesoriaOpen, setAsesoriaOpen] = useState(false)
  const [showSavedQuotes, setShowSavedQuotes] = useState(false)

  const hasFilters = Boolean(search || projectId || status)
  const onCotizador = tab === 'solicitudes' && !showSavedQuotes
  const createLabel = tab === 'asesorias' ? 'Nueva asesoría' : 'Nuevo plan'
  const onCreate = () => {
    if (tab === 'interesados' || tab === 'solicitudes') return
    if (tab === 'asesorias') setAsesoriaOpen(true)
    else setPlanOpen(true)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Crédito inmobiliario"
        title={onCotizador ? 'Cotizador financiero' : 'Financiamiento'}
        description={
          onCotizador
            ? 'Simulación de crédito con inventario, planes e instituciones'
            : 'Planes de pago, proformas guardadas y pedidos de asesoría'
        }
        actions={
          <>
            {tab === 'solicitudes' && (
              <Button
                variant={showSavedQuotes ? 'primary' : 'outline'}
                onClick={() => setShowSavedQuotes((v) => !v)}
              >
                {showSavedQuotes ? 'Volver al cotizador' : 'Proformas guardadas'}
              </Button>
            )}
            {tab !== 'interesados' && tab !== 'solicitudes' && (
              <Button onClick={onCreate}>
                <Plus size={16} className="mr-2" />
                {createLabel}
              </Button>
            )}
          </>
        }
      />

      <div className="crm-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            data-active={tab === item.id}
            onClick={() => {
              setTab(item.id)
              if (item.id !== 'solicitudes') setShowSavedQuotes(false)
            }}
            className="crm-tab"
          >
            {item.label}
          </button>
        ))}
      </div>

      {!onCotizador && (
      <InmobiliariaFiltersToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={
          tab === 'planes'
            ? 'Buscar plan...'
            : tab === 'solicitudes'
              ? 'Buscar lead, unidad o nota...'
              : tab === 'asesorias'
                ? 'Buscar lead o mensaje...'
                : 'Buscar lead...'
        }
        resultsTotal={
          tab === 'planes'
            ? plans.length
            : tab === 'solicitudes'
              ? requests.length
              : tab === 'asesorias'
                ? asesorias.length
                : interestedLeads.length
        }
        hasActiveFilters={hasFilters}
        onReset={resetFilters}
      >
        {tab === 'planes' && (
          <Select
            label="Proyecto"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Todos"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full"
          />
        )}
        {tab === 'solicitudes' && (
          <Select
            label="Estado"
            options={LEAD_FINANCING_STATUS_OPTIONS}
            placeholder="Todos"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full"
          />
        )}
      </InmobiliariaFiltersToolbar>
      )}

      {onCotizador ? (
        <FinancingCotizador
          tenantId={tenantId}
          partners={partners}
          plans={plans}
          onSaved={reload}
        />
      ) : isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : tab === 'planes' ? (
        plans.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No hay planes de pago"
            description="Crea un plan vinculado a un proyecto. Se guarda en payment_plans."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Plan</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Proyecto</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Aplica a</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Reserva</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Entrada</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Saldo</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="border-b border-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{plan.name}</p>
                      {plan.conditions && (
                        <p className="mt-0.5 max-w-xs truncate text-xs text-gray-500">{plan.conditions}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{plan.project?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{plan.applies_to_category ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {plan.reservation_amount != null ? (
                        <PriceText value={plan.reservation_amount} size="sm" />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {plan.entry_pct != null ? `${plan.entry_pct}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {PAYMENT_PLAN_BALANCE_OPTIONS.find((o) => o.value === plan.balance_type)?.label ??
                        plan.balance_type ??
                        '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
                          plan.is_active
                            ? 'border border-[#3d5c45]/40 bg-[#3d5c45]/10 text-[#2c4634]'
                            : 'border border-[#6b5348]/30 bg-[#6b5348]/10 text-[#6b5348]',
                        )}
                      >
                        {plan.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'solicitudes' ? (
        requests.length === 0 ? (
          <EmptyState
            icon={CircleDollarSign}
            title="No hay proformas"
            description="Abre el cotizador: elige lead, unidad e institución. Se guarda como simulación en lead_financing."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Lead</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Unidad</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Institución</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tipo</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Precio</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Entrada</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Financiado</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Plazo</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Tasa</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Cuota</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.lead?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {row.unit
                        ? `${row.unit.unit_number}${row.unit.project?.name ? ` · ${row.unit.project.name}` : ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {row.partner?.name ??
                        partners.find((p) => p.id === row.financing_partner_id)?.name ??
                        '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {FINANCING_TYPE_OPTIONS.find((o) => o.value === row.financing_type)?.label ??
                        row.financing_type ??
                        '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.unit_price != null ? <PriceText value={row.unit_price} size="sm" /> : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.entry_amount != null ? <PriceText value={row.entry_amount} size="sm" /> : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.financed_amount != null ? <PriceText value={row.financed_amount} size="sm" /> : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {row.term_months != null ? `${row.term_months} m` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {row.interest_rate != null ? `${row.interest_rate}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.monthly_payment != null ? <PriceText value={row.monthly_payment} size="sm" /> : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} type="financing" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'asesorias' ? (
        asesorias.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="No hay solicitudes de asesoría"
            description="Elige un lead y pega el mensaje del cliente. Se guarda en asesoria_financiamiento."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Lead</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Mensaje</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {asesorias.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.lead?.name ?? '—'}</td>
                    <td className="px-4 py-3 max-w-xl text-gray-600">
                      <p className="line-clamp-2">{row.mensaje_completo ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
                          row.atendido
                            ? 'border border-[#3d5c45]/40 bg-[#3d5c45]/10 text-[#2c4634]'
                            : 'border border-[#9a6b2f]/40 bg-[#9a6b2f]/12 text-[#6b4a20]',
                        )}
                      >
                        {row.atendido ? 'Atendido' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(row.created_at).toLocaleString('es-EC')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : interestedLeads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nadie marcado con financiamiento"
          description="Los leads con el flag de crédito (leads.financing) aparecen aquí."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Lead</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Teléfono</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Responsable</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Presupuesto</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Temperatura</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
              </tr>
            </thead>
            <tbody>
              {interestedLeads.map((lead) => (
                <tr key={lead.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{lead.name}</td>
                  <td className="px-4 py-3 text-gray-600">{lead.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <PersonCell
                      name={lead.assigned_profile?.full_name}
                      avatarUrl={lead.assigned_profile?.avatar_url}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {lead.budget != null ? <PriceText value={lead.budget} size="sm" /> : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={lead.temperature || 'frio'} type="temperature" />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={lead.status} type="lead" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreatePaymentPlanModal
        isOpen={planOpen}
        onClose={() => setPlanOpen(false)}
        onCreated={reload}
        projects={projects}
      />
      <CreateAsesoriaModal
        isOpen={asesoriaOpen}
        onClose={() => setAsesoriaOpen(false)}
        onCreated={reload}
        tenantId={tenantId}
      />
    </div>
  )
}
