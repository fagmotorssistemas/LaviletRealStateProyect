'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/contexts/AuthContext'
import {
  countUnitsForExport,
  fetchUnitsForExport,
} from '@/services/inmobiliaria.service'
import {
  INVENTORY_EXPORT_FIELDS,
  INVENTORY_EXPORT_FIELD_GROUPS,
  buildInventoryExportFilename,
  buildInventoryExportTable,
  getDefaultInventoryExportFieldSelection,
  type InventoryExportFieldId,
} from '@/lib/inmobiliaria/inventoryExport'
import type { Project, UnitStatus, InventorySortOption } from '@/types/inmobiliaria'
import { INVENTORY_SORT_OPTIONS, UNIT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, FileText, Filter, Loader2, Table2 } from 'lucide-react'

const ALL_STATUSES = UNIT_STATUS_OPTIONS.map((o) => o.value)

export interface ExportTableFiltersSnapshot {
  projectId: string
  status: string
  category: string
  sortBy: InventorySortOption
}

interface ExportInventoryModalProps {
  isOpen: boolean
  onClose: () => void
  tenantId: string
  projects: Project[]
  tableFilters: ExportTableFiltersSnapshot
  categoryOptions: { value: string; label: string }[]
}

type ExportFormat = 'xlsx' | 'pdf'

const initialStatuses = (): Record<UnitStatus, boolean> =>
  Object.fromEntries(ALL_STATUSES.map((s) => [s, true])) as Record<UnitStatus, boolean>

export function ExportInventoryModal({
  isOpen,
  onClose,
  tenantId,
  projects,
  tableFilters,
  categoryOptions,
}: ExportInventoryModalProps) {
  const { supabase } = useAuth()
  const [statuses, setStatuses] = useState<Record<UnitStatus, boolean>>(initialStatuses)
  const [projectId, setProjectId] = useState('')
  const [category, setCategory] = useState('')
  const [sortBy, setSortBy] = useState<InventorySortOption>('unit_natural')
  const [fields, setFields] = useState<Record<InventoryExportFieldId, boolean>>(() =>
    getDefaultInventoryExportFieldSelection(),
  )
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setStatuses(initialStatuses())
    setProjectId('')
    setCategory('')
    setSortBy('unit_natural')
    setFields(getDefaultInventoryExportFieldSelection())
    setFormat('xlsx')
    setPreviewCount(null)
  }, [isOpen])

  const effectiveStatuses = useMemo(() => {
    const sel = ALL_STATUSES.filter((s) => statuses[s])
    if (sel.length === 0) return null as UnitStatus[] | null
    if (sel.length === ALL_STATUSES.length) return undefined
    return sel
  }, [statuses])

  const selectedFieldIds = useMemo(
    () => INVENTORY_EXPORT_FIELDS.filter((f) => fields[f.id]).map((f) => f.id),
    [fields],
  )

  const syncFromTable = useCallback(() => {
    setProjectId(tableFilters.projectId)
    setCategory(tableFilters.category)
    setSortBy(tableFilters.sortBy)
    if (tableFilters.status) {
      const only = tableFilters.status as UnitStatus
      setStatuses(
        Object.fromEntries(ALL_STATUSES.map((s) => [s, s === only])) as Record<UnitStatus, boolean>,
      )
    } else {
      setStatuses(initialStatuses())
    }
    toast.success('Se aplicaron los filtros de la lista actual')
  }, [tableFilters])

  useEffect(() => {
    if (!isOpen || !tenantId) {
      setPreviewCount(null)
      return
    }
    if (effectiveStatuses === null) {
      setPreviewCount(0)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      setPreviewLoading(true)
      countUnitsForExport(supabase, {
        tenantId,
        projectId: projectId || undefined,
        statuses: effectiveStatuses,
        category: category || undefined,
      })
        .then((n) => {
          if (!cancelled) setPreviewCount(n)
        })
        .catch(() => {
          if (!cancelled) {
            setPreviewCount(null)
            toast.error('No se pudo calcular el alcance')
          }
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false)
        })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [isOpen, tenantId, supabase, projectId, category, effectiveStatuses])

  const setAllStatuses = (value: boolean) => {
    setStatuses(Object.fromEntries(ALL_STATUSES.map((s) => [s, value])) as Record<UnitStatus, boolean>)
  }

  const applyStatusPreset = (preset: 'pipeline' | 'commercial' | 'closed' | 'available') => {
    const next = Object.fromEntries(ALL_STATUSES.map((s) => [s, false])) as Record<UnitStatus, boolean>
    const mark = (keys: UnitStatus[]) => keys.forEach((k) => (next[k] = true))
    switch (preset) {
      case 'available':
        mark(['disponible', 'en_preventa'])
        break
      case 'pipeline':
        mark(['reservado', 'en_proceso', 'bajo_contrato'])
        break
      case 'commercial':
        mark(['disponible', 'en_preventa', 'reservado', 'en_proceso', 'bajo_contrato'])
        break
      case 'closed':
        mark(['vendido', 'deshabilitado'])
        break
    }
    setStatuses(next)
  }

  const setFieldPreset = (preset: 'all' | 'default' | 'minimal') => {
    if (preset === 'all') {
      setFields(
        Object.fromEntries(INVENTORY_EXPORT_FIELDS.map((f) => [f.id, true])) as Record<
          InventoryExportFieldId,
          boolean
        >,
      )
      return
    }
    if (preset === 'default') {
      setFields(getDefaultInventoryExportFieldSelection())
      return
    }
    const m = Object.fromEntries(INVENTORY_EXPORT_FIELDS.map((f) => [f.id, false])) as Record<
      InventoryExportFieldId,
      boolean
    >
    ;(['project', 'unit_number', 'category', 'floor', 'status', 'area_total_m2', 'published_commercial_price'] as const).forEach(
      (k) => {
        m[k] = true
      },
    )
    setFields(m)
  }

  const toggleField = (id: InventoryExportFieldId) => setFields((p) => ({ ...p, [id]: !p[id] }))

  const toggleGroup = (groupId: (typeof INVENTORY_EXPORT_FIELD_GROUPS)[number]['id'], value: boolean) => {
    setFields((prev) => {
      const next = { ...prev }
      for (const f of INVENTORY_EXPORT_FIELDS) {
        if (f.group === groupId) next[f.id] = value
      }
      return next
    })
  }

  const handleExport = async () => {
    if (!tenantId) {
      toast.error('No hay inmobiliaria cargada')
      return
    }
    if (effectiveStatuses === null) {
      toast.error('Selecciona al menos un estado comercial')
      return
    }
    if (selectedFieldIds.length === 0) {
      toast.error('Selecciona al menos una columna')
      return
    }
    if (previewCount === 0) {
      toast.error('No hay unidades que coincidan con el alcance')
      return
    }
    setExporting(true)
    try {
      const { downloadInventoryExcel, downloadInventoryPdf } = await import(
        '@/lib/inmobiliaria/inventoryExportDownloads'
      )
      const units = await fetchUnitsForExport(supabase, {
        tenantId,
        projectId: projectId || undefined,
        statuses: effectiveStatuses,
        category: category || undefined,
        sort: sortBy,
      })
      const { headers, rows } = buildInventoryExportTable(units, selectedFieldIds)
      const baseName = 'inventario_lavilet'
      const projLabel = projectId ? projects.find((p) => p.id === projectId)?.name : 'Todos los proyectos'
      const statusNote =
        effectiveStatuses === undefined
          ? 'Estados: todos'
          : `Estados: ${effectiveStatuses.map((s) => UNIT_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s).join(', ')}`
      const subtitle = `${projLabel} · ${statusNote} · ${units.length} unidad(es) — ${new Date().toLocaleString('es-EC')}`

      if (format === 'xlsx') {
        const fn = buildInventoryExportFilename(baseName, 'xlsx')
        await downloadInventoryExcel(headers, rows, fn)
        toast.success(`Excel generado (${units.length} filas)`)
      } else {
        const fn = buildInventoryExportFilename(baseName, 'pdf')
        await downloadInventoryPdf({
          title: 'Inventario de unidades',
          subtitle,
          headers,
          rows,
          filename: fn,
        })
        toast.success(`PDF generado (${units.length} filas)`)
      }
      onClose()
    } catch (e) {
      console.error(e)
      toast.error('Error al exportar')
    } finally {
      setExporting(false)
    }
  }

  const projectSelectOptions = projects.map((p) => ({ value: p.id, label: p.name }))

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Exportar inventario" size="xl" className="max-h-[90vh]">
      <div className="flex max-h-[calc(90vh-8rem)] flex-col gap-6 overflow-y-auto pr-1">
        {/* Alcance */}
        <section className="rounded-xl border border-gray-100 bg-gray-50/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[#2B1A18]">
              <Filter size={16} aria-hidden />
              Qué incluir
            </h3>
            <Button type="button" variant="outline" size="sm" onClick={syncFromTable} className="gap-1.5">
              <Table2 size={14} aria-hidden />
              Igual que la lista actual
            </Button>
          </div>
          <p className="mb-4 text-xs text-gray-500">
            Ajusta proyecto y categoría como en el listado. Los estados permiten exportar solo disponibles, vendidos,
            etc.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="exp-project"
              label="Proyecto"
              options={projectSelectOptions}
              placeholder="Todos los proyectos"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            />
            <Select
              id="exp-category"
              label="Categoría"
              options={categoryOptions}
              placeholder="Todas"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <div className="sm:col-span-2">
              <Select
                id="exp-sort"
                label="Orden en el archivo"
                options={INVENTORY_SORT_OPTIONS}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as InventorySortOption)}
              />
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-700">Estados comerciales</span>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAllStatuses(true)}>
                  Todos
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => applyStatusPreset('available')}>
                  Disponible + preventa
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => applyStatusPreset('pipeline')}>
                  En gestión
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => applyStatusPreset('commercial')}>
                  Activos comerciales
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => applyStatusPreset('closed')}>
                  Cerrados / vendidos
                </Button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {UNIT_STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-800 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={statuses[opt.value]}
                    onChange={(e) => setStatuses((p) => ({ ...p, [opt.value]: e.target.checked }))}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {effectiveStatuses === null && (
              <p className="mt-2 text-xs font-medium text-red-600">Marca al menos un estado.</p>
            )}
          </div>
        </section>

        {/* Columnas */}
        <section className="rounded-xl border border-gray-100 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#2B1A18]">Columnas del archivo</h3>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFieldPreset('all')}>
                Todas
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFieldPreset('default')}>
                Recomendado
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFieldPreset('minimal')}>
                Mínimo
              </Button>
            </div>
          </div>
          {INVENTORY_EXPORT_FIELD_GROUPS.map((g) => {
            const groupFields = INVENTORY_EXPORT_FIELDS.filter((f) => f.group === g.id)
            const allOn = groupFields.every((f) => fields[f.id])
            return (
              <div key={g.id} className="mb-4 last:mb-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{g.label}</span>
                  <button
                    type="button"
                    className="text-xs text-[#BDA27E] hover:underline"
                    onClick={() => toggleGroup(g.id, !allOn)}
                  >
                    {allOn ? 'Desmarcar grupo' : 'Marcar todo el grupo'}
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {groupFields.map((f) => (
                    <label
                      key={f.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-50 bg-gray-50/50 px-3 py-2 text-sm text-gray-800"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={fields[f.id]}
                        onChange={() => toggleField(f.id)}
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </section>

        {/* Formato */}
        <section className="rounded-xl border border-gray-100 bg-gray-50/40 p-4">
          <h3 className="mb-3 text-sm font-semibold text-[#2B1A18]">Formato de archivo</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFormat('xlsx')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors sm:min-w-[140px] ${
                format === 'xlsx'
                  ? 'border-[#2B1A18] bg-[#2B1A18] text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              <FileSpreadsheet size={18} aria-hidden />
              Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => setFormat('pdf')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors sm:min-w-[140px] ${
                format === 'pdf'
                  ? 'border-[#2B1A18] bg-[#2B1A18] text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              <FileText size={18} aria-hidden />
              PDF
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Excel permite filtrar y pivotear en tu equipo. PDF sirve para compartir o imprimir un listado fijo.
          </p>
        </section>

        <div className="sticky bottom-0 flex flex-col gap-3 border-t border-gray-100 bg-white pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            {previewLoading ? (
              <>
                <Loader2 size={16} className="animate-spin text-gray-400" aria-hidden />
                Calculando…
              </>
            ) : previewCount !== null ? (
              <span>
                <strong className="text-[#2B1A18]">{previewCount}</strong> unidad(es) coinciden con el alcance
              </span>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={exporting}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || previewCount === 0 || effectiveStatuses === null || selectedFieldIds.length === 0}
              className="gap-2"
            >
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} aria-hidden />}
              {exporting ? 'Generando…' : `Descargar ${format === 'xlsx' ? 'Excel' : 'PDF'}`}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
