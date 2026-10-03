export type CatalogSearchSettings = { embeddingsEnabled: boolean }

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function catalogSearchSettings(policies: unknown): CatalogSearchSettings {
  return { embeddingsEnabled: record(record(policies).catalog_search).embeddings_enabled === true }
}

export function changeCatalogSearch(policies: unknown, enabled: boolean, userId: string, at: string) {
  if (typeof enabled !== 'boolean') throw Error('Seleccione activar o desactivar la búsqueda por embeddings.')
  return { ...record(policies), catalog_search: { ...record(record(policies).catalog_search),
    embeddings_enabled: enabled, updated_by: userId, updated_at: at } }
}
