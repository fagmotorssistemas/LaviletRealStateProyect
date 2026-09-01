'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { useAuth } from '@/contexts/AuthContext'
import { listContracts, listLeads, listUnits } from '@/services/inmobiliaria.service'
import { recordUnitClosingAction } from '@/app/inmobiliaria/ventas/actions'
import type { Contract, Lead, Project, TeamProfile, Unit } from '@/types/inmobiliaria'

interface CreateClosingModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  tenantId: string
  projects: Project[]
  advisors: TeamProfile[]
}

const todayLocal = () => {
  const now = new Date()
  const y = now.getFullYear()
  const m = `${now.getMonth() + 1}`.padStart(2, '0')
  const d = `${now.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function CreateClosingModal({
  isOpen,
  onClose,
  onCreated,
  tenantId,
  projects,
  advisors,
}: CreateClosingModalProps) {
  const { supabase, user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null)
  const [unitSearchQuery, setUnitSearchQuery] = useState('')
  const [unitSearchResults, setUnitSearchResults] = useState<Unit[]>([])
  const [searchingUnits, setSearchingUnits] = useState(false)
  const unitSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [form, setForm] = useState({
    project_id: '',
    lead_id: '',
    sold_by_id: '',
    sale_price_final: '',
    published_price_snapshot: '',
    sale_at: todayLocal(),
    contract_id: '',
    notes: '',
  })

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  useEffect(() => {
    if (!isOpen || !tenantId) return
    Promise.all([
      listLeads(supabase, { tenantId, page: 1, pageSize: 100 }),
      listContracts(supabase, { tenantId, page: 1, pageSize: 50 }),
    ])
      .then(([leadRes, contractRes]) => {
        setLeads(leadRes.data)
        setContracts(contractRes.data)
      })
      .catch(console.error)
    setForm((prev) => ({
      ...prev,
      sold_by_id: prev.sold_by_id || user?.id || '',
      sale_at: prev.sale_at || todayLocal(),
    }))
  }, [isOpen, tenantId, supabase, user?.id])

  const handleUnitSearch = (query: string) => {
    setUnitSearchQuery(query)
    if (unitSearchTimerRef.current) clearTimeout(unitSearchTimerRef.current)
    if (!query.trim()) {
      setUnitSearchResults([])
      return
    }
    unitSearchTimerRef.current = setTimeout(async () => {
      setSearchingUnits(true)
      try {
        const { data } = await listUnits(supabase, {
          tenantId,
          projectId: form.project_id || undefined,
          search: query,
          pageSize: 20,
        })
        setUnitSearchResults(data ?? [])
      } catch {
        setUnitSearchResults([])
      } finally {
        setSearchingUnits(false)
      }
    }, 300)
  }

  const pickUnit = (unit: Unit) => {
    setSelectedUnit(unit)
    setUnitSearchQuery('')
    setUnitSearchResults([])
    setForm((p) => ({
      ...p,
      project_id: unit.project_id || p.project_id,
      published_price_snapshot:
        unit.published_commercial_price != null ? String(unit.published_commercial_price) : p.published_price_snapshot,
      sale_price_final:
        p.sale_price_final ||
        (unit.published_commercial_price != null ? String(unit.published_commercial_price) : ''),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUnit) {
      toast.error('Elige la unidad vendida')
      return
    }
    if (!form.sold_by_id) {
      toast.error('Elige el asesor que cerró la venta')
      return
    }
    const salePrice = Number(form.sale_price_final)
    if (!Number.isFinite(salePrice) || salePrice <= 0) {
      toast.error('El precio de cierre es obligatorio')
      return
    }

    setLoading(true)
    try {
      const saleAt = form.sale_at
        ? new Date(`${form.sale_at}T12:00:00`).toISOString()
        : new Date().toISOString()
      await recordUnitClosingAction({
        tenant_id: tenantId,
        unit_id: selectedUnit.id,
        lead_id: form.lead_id || null,
        sold_by_id: form.sold_by_id,
        sale_price_final: salePrice,
        published_price_snapshot: form.published_price_snapshot ? Number(form.published_price_snapshot) : null,
        sale_at: saleAt,
        notes: form.notes || null,
        contract_id: form.contract_id || null,
      })
      toast.success('Cierre registrado')
      onCreated()
      onClose()
      setSelectedUnit(null)
      setForm({
        project_id: '',
        lead_id: '',
        sold_by_id: user?.id || '',
        sale_price_final: '',
        published_price_snapshot: '',
        sale_at: todayLocal(),
        contract_id: '',
        notes: '',
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo registrar el cierre')
    } finally {
      setLoading(false)
    }
  }

  const leadOptions = useMemo(
    () => leads.map((l) => ({ value: l.id, label: l.name })),
    [leads],
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar cierre de venta" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          id="closing-project"
          label="Proyecto"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Opcional, para filtrar unidades"
          value={form.project_id}
          onChange={(e) => update('project_id', e.target.value)}
        />

        <div>
          <label className="text-sm font-medium text-gray-700">Unidad vendida *</label>
          {selectedUnit ? (
            <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <Building2 className="h-4 w-4 text-slate-500" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{selectedUnit.unit_number}</p>
                <p className="text-xs text-slate-400">
                  {selectedUnit.project?.name ?? selectedUnit.category}
                </p>
              </div>
              <StatusBadge status={selectedUnit.status} type="unit" />
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-red-600 cursor-pointer"
                onClick={() => setSelectedUnit(null)}
              >
                Cambiar
              </button>
            </div>
          ) : (
            <div className="relative mt-1.5">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={unitSearchQuery}
                onChange={(e) => handleUnitSearch(e.target.value)}
                placeholder="Buscar por número de unidad..."
                className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm focus:border-[#3a3d36] focus:outline-none focus:ring-2 focus:ring-[#8b917c]/30"
              />
              {searchingUnits && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
              )}
              {unitSearchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {unitSearchResults.map((unit) => (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => pickUnit(unit)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 cursor-pointer"
                    >
                      <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="font-medium text-slate-700">{unit.unit_number}</span>
                      <span className="truncate text-xs text-slate-400">{unit.project?.name}</span>
                      <StatusBadge status={unit.status} type="unit" className="ml-auto shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            id="closing-lead"
            label="Cliente / lead"
            options={leadOptions}
            placeholder="Opcional"
            value={form.lead_id}
            onChange={(e) => update('lead_id', e.target.value)}
          />
          <Select
            id="closing-advisor"
            label="Asesor *"
            options={advisors.map((a) => ({ value: a.id, label: a.full_name || 'Sin nombre' }))}
            placeholder="Quién cerró"
            value={form.sold_by_id}
            onChange={(e) => update('sold_by_id', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            id="closing-list"
            label="Precio de lista"
            type="number"
            min="0"
            step="0.01"
            value={form.published_price_snapshot}
            onChange={(e) => update('published_price_snapshot', e.target.value)}
          />
          <Input
            id="closing-final"
            label="Precio de cierre *"
            type="number"
            min="0"
            step="0.01"
            value={form.sale_price_final}
            onChange={(e) => update('sale_price_final', e.target.value)}
          />
          <Input
            id="closing-date"
            label="Fecha de venta *"
            type="date"
            value={form.sale_at}
            onChange={(e) => update('sale_at', e.target.value)}
          />
        </div>

        <Select
          id="closing-contract"
          label="Contrato"
          options={contracts.map((c) => ({
            value: c.id,
            label: c.contract_number || c.id.slice(0, 8),
          }))}
          placeholder="Opcional"
          value={form.contract_id}
          onChange={(e) => update('contract_id', e.target.value)}
        />

        <Textarea
          id="closing-notes"
          label="Notas"
          placeholder="Condiciones, descuento, observaciones..."
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Guardando...' : 'Registrar cierre'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
