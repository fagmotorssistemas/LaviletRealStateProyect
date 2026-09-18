/**
 * Métricas oficiales Meta (agregados Pixel/Events Manager).
 * Nunca inventa filas individuales de PageView ni mezcla con outbox.
 */
export type MetaOfficialAggregateRow = {
  eventName: string
  count: number
  windowStart: string | null
  windowEnd: string | null
  datasetHint: string | null
}

export type MetaOfficialMetricsResult =
  | {
      available: true
      aggregates: MetaOfficialAggregateRow[]
      note: string
      fetchedAt: string
    }
  | {
      available: false
      reason: string
      aggregates: []
    }

function graphToken(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  return (
    env.META_GRAPH_ACCESS_TOKEN?.trim() ||
    env.META_MARKETING_ACCESS_TOKEN?.trim() ||
    env.META_SYSTEM_USER_TOKEN?.trim() ||
    ''
  )
}

function pixelOrDatasetId(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  return (
    env.META_EVENTS_DATASET_ID?.trim() ||
    env.META_PIXEL_ID?.trim() ||
    env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ||
    ''
  )
}

export function metaOfficialMetricsCredentialsPresent(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(graphToken(env) && pixelOrDatasetId(env))
}

/**
 * Intenta leer agregados del dataset/píxel vía Graph.
 * Si faltan permisos/credenciales → available:false con mensaje explícito (no “0 eventos”).
 */
export async function fetchMetaOfficialAggregates(opts?: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<MetaOfficialMetricsResult> {
  const env = opts?.env ?? process.env
  const token = graphToken(env)
  const datasetId = pixelOrDatasetId(env)
  if (!token || !datasetId) {
    return {
      available: false,
      reason:
        'Fuente no disponible / permiso pendiente: faltan META_GRAPH_ACCESS_TOKEN (o META_MARKETING_ACCESS_TOKEN) y META_EVENTS_DATASET_ID / META_PIXEL_ID para consultar agregados oficiales de Meta.',
      aggregates: [],
    }
  }

  const fetchImpl = opts?.fetchImpl ?? fetch
  const version = (env.META_GRAPH_API_VERSION || 'v21.0').replace(/^\/*/, '')
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(datasetId)}/stats`)
  url.searchParams.set('aggregation', 'event')
  url.searchParams.set('access_token', token)

  try {
    const res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: opts?.signal ?? AbortSignal.timeout(4000),
    })
    if (res.status === 401 || res.status === 403) {
      return {
        available: false,
        reason:
          'Fuente no disponible / permiso pendiente: el token Graph no tiene acceso de lectura a stats del dataset/píxel.',
        aggregates: [],
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        available: false,
        reason: `Fuente no disponible / permiso pendiente: Graph respondió ${res.status}${body ? ` (${body.slice(0, 120)})` : ''}.`,
        aggregates: [],
      }
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: Array<Record<string, unknown>> }
      | null
    const rows = Array.isArray(json?.data) ? json!.data! : []
    const aggregates: MetaOfficialAggregateRow[] = []
    for (const row of rows) {
      const eventName = String(row.event || row.event_name || row.name || '').trim()
      const count = Number(row.count ?? row.value ?? row.total ?? NaN)
      if (!eventName || !Number.isFinite(count)) continue
      aggregates.push({
        eventName,
        count,
        windowStart:
          typeof row.start_time === 'string'
            ? row.start_time
            : typeof row.start_time === 'number'
              ? new Date(row.start_time * 1000).toISOString()
              : null,
        windowEnd:
          typeof row.end_time === 'string'
            ? row.end_time
            : typeof row.end_time === 'number'
              ? new Date(row.end_time * 1000).toISOString()
              : null,
        datasetHint: datasetId.length > 12 ? `${datasetId.slice(0, 6)}…${datasetId.slice(-4)}` : datasetId,
      })
    }
    return {
      available: true,
      aggregates,
      note:
        'Agregados oficiales Meta (Pixel/dataset). No son filas individuales ni se suman a la cola CAPI.',
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      available: false,
      reason: `Fuente no disponible / permiso pendiente: ${
        error instanceof Error ? error.message.slice(0, 160) : 'error al consultar Graph'
      }`,
      aggregates: [],
    }
  }
}
