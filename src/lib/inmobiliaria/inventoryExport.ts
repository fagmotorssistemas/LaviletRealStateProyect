import type { Unit, UnitStatus } from '@/types/inmobiliaria'
import { UNIT_STATUS_OPTIONS } from '@/types/inmobiliaria'

export const INVENTORY_EXPORT_FIELD_GROUPS = [
  { id: 'identificacion', label: 'Identificación y estado' },
  { id: 'superficies', label: 'Superficies (m²)' },
  { id: 'comercial', label: 'Comercial' },
  { id: 'otros', label: 'Texto y metadatos' },
] as const

export type InventoryExportFieldGroupId = (typeof INVENTORY_EXPORT_FIELD_GROUPS)[number]['id']

export const INVENTORY_EXPORT_FIELDS = [
  { id: 'project', label: 'Proyecto', group: 'identificacion' as const },
  { id: 'unit_number', label: 'Nº unidad', group: 'identificacion' as const },
  { id: 'category', label: 'Categoría', group: 'identificacion' as const },
  { id: 'unit_subtype', label: 'Subtipo', group: 'identificacion' as const },
  { id: 'floor', label: 'Piso', group: 'identificacion' as const },
  { id: 'status', label: 'Estado', group: 'identificacion' as const },
  { id: 'area_internal_m2', label: 'Área interna', group: 'superficies' as const },
  { id: 'area_terrace_covered_m2', label: 'Terraza cubierta', group: 'superficies' as const },
  { id: 'area_terrace_open_m2', label: 'Terraza descubierta', group: 'superficies' as const },
  { id: 'area_total_m2', label: 'Área total', group: 'superficies' as const },
  { id: 'parking_assigned', label: 'Parqueos', group: 'comercial' as const },
  { id: 'cost_per_m2_internal', label: 'Costo / m²', group: 'comercial' as const },
  { id: 'published_commercial_price', label: 'Precio comercial', group: 'comercial' as const },
  { id: 'description', label: 'Descripción', group: 'otros' as const },
  { id: 'slug', label: 'Slug', group: 'otros' as const },
  { id: 'created_at', label: 'Fecha de alta', group: 'otros' as const },
  { id: 'updated_at', label: 'Última actualización', group: 'otros' as const },
] as const

export type InventoryExportFieldId = (typeof INVENTORY_EXPORT_FIELDS)[number]['id']

const STATUS_LABEL = new Map<UnitStatus, string>(
  UNIT_STATUS_OPTIONS.map((o) => [o.value, o.label]),
)

function formatStatus(status: UnitStatus): string {
  return STATUS_LABEL.get(status) ?? status
}

function formatNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('es-EC', { maximumFractionDigits: 2 })
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function getInventoryExportCell(unit: Unit, fieldId: InventoryExportFieldId): string {
  const p = unit.project as { name?: string } | undefined
  switch (fieldId) {
    case 'project':
      return p?.name ?? '—'
    case 'unit_number':
      return unit.unit_number ?? '—'
    case 'category':
      return unit.category ?? '—'
    case 'unit_subtype':
      return unit.unit_subtype ?? '—'
    case 'floor':
      return unit.floor ?? '—'
    case 'status':
      return formatStatus(unit.status)
    case 'area_internal_m2':
      return formatNum(unit.area_internal_m2)
    case 'area_terrace_covered_m2':
      return formatNum(unit.area_terrace_covered_m2)
    case 'area_terrace_open_m2':
      return formatNum(unit.area_terrace_open_m2)
    case 'area_total_m2':
      return formatNum(unit.area_total_m2)
    case 'parking_assigned':
      return String(unit.parking_assigned ?? 0)
    case 'cost_per_m2_internal':
      return formatMoney(unit.cost_per_m2_internal)
    case 'published_commercial_price':
      return formatMoney(unit.published_commercial_price)
    case 'description':
      return (unit.description ?? '').replace(/\s+/g, ' ').trim() || '—'
    case 'slug':
      return unit.slug ?? '—'
    case 'created_at':
      return formatDate(unit.created_at)
    case 'updated_at':
      return formatDate(unit.updated_at)
    default:
      return '—'
  }
}

/** Valores por defecto: columnas útiles sin slug ni fechas técnicas. */
export function getDefaultInventoryExportFieldSelection(): Record<InventoryExportFieldId, boolean> {
  const r = {} as Record<InventoryExportFieldId, boolean>
  for (const f of INVENTORY_EXPORT_FIELDS) {
    r[f.id] = !['slug', 'created_at', 'updated_at'].includes(f.id)
  }
  return r
}

export function buildInventoryExportTable(
  units: Unit[],
  selectedFields: InventoryExportFieldId[],
): { headers: string[]; rows: string[][] } {
  const headers = selectedFields.map((id) => INVENTORY_EXPORT_FIELDS.find((f) => f.id === id)!.label)
  const rows = units.map((u) => selectedFields.map((id) => getInventoryExportCell(u, id)))
  return { headers, rows }
}

export function buildInventoryExportFilename(base: string, ext: 'xlsx' | 'pdf'): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  return `${base}_${stamp}.${ext}`
}
