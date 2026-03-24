import type { ProjectAssetKind, ProjectConstructionPhase } from '@/types/inmobiliaria'

export const CONSTRUCTION_PHASE_OPTIONS: { value: ProjectConstructionPhase; label: string }[] = [
  { value: 'preventa', label: 'Preventa' },
  { value: 'en_construccion', label: 'En construcción' },
  { value: 'entrega_proxima', label: 'Entrega próxima' },
  { value: 'entregado', label: 'Entregado' },
]

export const PROJECT_ASSET_KIND_OPTIONS: { value: ProjectAssetKind; label: string }[] = [
  { value: 'photo', label: 'Foto del proyecto' },
  { value: 'floor_plan', label: 'Plano (PDF o imagen)' },
  { value: 'brochure', label: 'Brochure / dossier' },
  { value: 'document', label: 'Documento' },
  { value: 'other', label: 'Otro' },
]

export function constructionPhaseLabel(phase: ProjectConstructionPhase | null | undefined): string {
  if (!phase) return '—'
  return CONSTRUCTION_PHASE_OPTIONS.find((o) => o.value === phase)?.label ?? phase
}

export function assetKindLabel(kind: ProjectAssetKind): string {
  return PROJECT_ASSET_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind
}
