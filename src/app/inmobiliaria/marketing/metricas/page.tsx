import { LAVILET_PROJECT_ID } from '@/lib/integrations/lavilet'
import { MarketingFunnelMetricsView } from '@/components/inmobiliaria/marketing/MarketingFunnelMetricsView'
import { getAdsInsightsStatus } from '@/lib/meta/adsInsightsStatus'
import {
  fetchMarketingFunnelMetrics,
  listMarketingFunnelProjects,
  probeAdsConnectionAction,
} from './actions'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Métricas embudo',
}

function defaultFrom() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 30)
  return d.toISOString().slice(0, 10)
}

/**
 * Embudo interno CTWA/CRM. No dispara CAPI.
 */
export default async function MarketingMetricasPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; projectId?: string; campaign?:string; ad?:string; q?:string }>
}) {
  const sp = await searchParams
  const from = sp.from || defaultFrom()
  const to = sp.to || new Date().toISOString().slice(0, 10)

  const probe = await probeAdsConnectionAction()
  const adsInsights = getAdsInsightsStatus(process.env, {
    connected: probe.connected,
    adAccountId: probe.adAccountId,
    currency: probe.currency,
    timezone: probe.timezone,
    fetchedAt: probe.fetchedAt,
    error: probe.error,
    accountName: probe.accountName,
  })

  let projects: { id: string; name: string }[] = []
  let projectsError: string | null = null
  try {
    projects = await listMarketingFunnelProjects()
  } catch (error) {
    projectsError =
      error instanceof Error
        ? error.message
        : 'No se pudieron cargar los proyectos del embudo'
  }

  const projectId =
    sp.projectId && projects.some((p) => p.id === sp.projectId)
      ? sp.projectId
      : projects[0]?.id || LAVILET_PROJECT_ID

  const result = projectsError
    ? { ok: false as const, error: projectsError }
    : await fetchMarketingFunnelMetrics({
        period: { from, to },
        projectId,
      })

  return (
    <MarketingFunnelMetricsView
      report={result.ok ? result.data : null}
      projects={projects}
      selectedProjectId={projectId}
      error={result.ok ? null : result.error}
      adsInsights={adsInsights}
      adsProbe={probe}
      initialFilters={{campaign:sp.campaign || '',ad:sp.ad || '',search:sp.q || ''}}
    />
  )
}
