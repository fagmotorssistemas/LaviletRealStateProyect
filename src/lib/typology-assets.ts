import type { TypologyAssetKind } from '@/types/inmobiliaria'

export const TYPOLOGY_ASSETS_BUCKET = 'typology-assets'
/** 12 MB: planos arquitectónicos en PNG suelen ir de 2 a 10 MB; deja margen sin saturar sharp. */
export const TYPOLOGY_ASSET_MAX_BYTES = 12 * 1024 * 1024
/** Un 360 de 8192×4096 en PNG/JPG suele ir de 15 a 60 MB. */
export const TYPOLOGY_PANO_MAX_BYTES = 80 * 1024 * 1024
export const TYPOLOGY_ASSET_KINDS: TypologyAssetKind[] = ['plano', 'render', 'ambiente']

export function isTypologyAssetKind(value: string): value is TypologyAssetKind {
  return TYPOLOGY_ASSET_KINDS.includes(value as TypologyAssetKind)
}

/** Nombre WebP: minúsculas, sin espacios ni tildes. */
export function typologyAssetFileName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, '')
  const slug =
    base
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'archivo'
  return `${slug}.webp`
}

export function typologyAssetStoragePath(
  typologyCode: string,
  kind: TypologyAssetKind,
  fileName: string,
): string {
  return `${typologyCode}/${kind}/${fileName}`
}
