/**
 * Parámetros de contenido para catálogo Meta Home Listings.
 * content_ids = home_listing_id = units.id
 * content_type = home_listing (docs Marketing API Real Estate Ads / audience)
 *
 * Identidad catálogo (ids + type) se envía siempre con unidad UUID.
 * content_name es opcional y se omite bajo Core Setup conservador.
 */
export const META_HOME_LISTING_CONTENT_TYPE = 'home_listing' as const

export type HomeListingContentParams = {
  content_ids: string[]
  content_type: typeof META_HOME_LISTING_CONTENT_TYPE
  content_name?: string
}

export function isMetaCoreSetupConservativeEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const raw = (
    env.META_CORE_SETUP_CONSERVATIVE ||
    env.NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE ||
    'true'
  )
    .trim()
    .toLowerCase()
  return raw !== 'false'
}

/** Solo con unitId UUID; showroom_general no lleva content_*. */
export function homeListingContentParams(
  unitId: string,
  opts?: { unitNumber?: string | null; contentName?: string | null },
): HomeListingContentParams | null {
  const id = String(unitId || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null
  }
  const unitNumber = String(opts?.unitNumber || '').trim()
  const explicitName = String(opts?.contentName || '').trim()
  const content_name =
    explicitName || (unitNumber ? `Unidad ${unitNumber}` : undefined) || undefined
  return {
    content_ids: [id],
    content_type: META_HOME_LISTING_CONTENT_TYPE,
    ...(content_name ? { content_name } : {}),
  }
}

/**
 * Identidad mínima del catálogo inmobiliario para Pixel/CAPI.
 * Siempre incluye content_ids + content_type cuando hay unit UUID.
 * content_name solo si includeContentName=true (fuera de Core Setup name strip).
 */
export function homeListingCatalogIdentityParams(
  unitId: string,
  opts?: {
    unitNumber?: string | null
    contentName?: string | null
    includeContentName?: boolean
  },
): HomeListingContentParams | null {
  const full = homeListingContentParams(unitId, opts)
  if (!full) return null
  if (opts?.includeContentName) return full
  return {
    content_ids: full.content_ids,
    content_type: full.content_type,
  }
}
