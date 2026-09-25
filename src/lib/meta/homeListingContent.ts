/**
 * Parámetros de contenido para catálogo Meta Home Listings.
 * content_ids = home_listing_id = units.id
 * content_type = home_listing (docs Marketing API Real Estate Ads / audience)
 *
 * No usar en Pixel/CAPI mientras META_CORE_SETUP_CONSERVATIVE esté activo.
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
