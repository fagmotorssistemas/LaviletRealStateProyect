import type { TypologyAssetKind } from '@/types/inmobiliaria'

export const TYPOLOGY_ASSETS_BUCKET = 'typology-assets'
export const TYPOLOGY_ASSET_KINDS: TypologyAssetKind[] = ['plano', 'render', 'ambiente']

export function isTypologyAssetKind(value: string): value is TypologyAssetKind {
  return TYPOLOGY_ASSET_KINDS.includes(value as TypologyAssetKind)
}

/** Nombre de archivo en storage: minúsculas, sin espacios ni tildes; conserva la extensión original. */
export function typologyAssetFileName(originalName: string): string {
  const extMatch = originalName.match(/\.([a-z0-9]+)$/i)
  const rawExt = (extMatch?.[1] || 'jpg').toLowerCase().replace(/jpeg/, 'jpg')
  const ext = ['png', 'jpg', 'webp', 'gif'].includes(rawExt) ? rawExt : 'jpg'
  const base = originalName.replace(/\.[^.]+$/, '')
  const slug =
    base
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'archivo'
  return `${slug}.${ext}`
}

export function typologyAssetStoragePath(
  typologyCode: string,
  kind: TypologyAssetKind,
  fileName: string,
): string {
  return `${typologyCode}/${kind}/${fileName}`
}

export type PlanoVariant = '2d' | '3d'

/** Prefijo en file_name: `2d-…` / `3d-…`. Sin prefijo → 2D (legado). */
export function planoVariantFromFileName(fileName: string): PlanoVariant {
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase()
  if (base.startsWith('3d-') || base.startsWith('3d_')) return '3d'
  return '2d'
}

export function matchesPlanoVariant(fileName: string, variant: PlanoVariant): boolean {
  return planoVariantFromFileName(fileName) === variant
}

/** Copia del archivo subido. No entra al catálogo ni se sirve en el showroom. */
export function typologyRenderOriginalPath(typologyCode: string, fileName: string) {
  return `${typologyCode}/render/_original/${fileName}`
}

/** `foto-r123.webp` → `foto_2048-r123.webp`. Misma revisión que el render de 3840. */
export function galleryRenderMobileFileName(fileName: string) {
  return fileName.replace(/(-r\d+)?\.webp$/i, (_match, revision: string | undefined) => `_2048${revision || ''}.webp`)
}
