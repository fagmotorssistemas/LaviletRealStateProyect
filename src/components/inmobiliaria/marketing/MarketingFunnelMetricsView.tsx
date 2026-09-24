import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { AdvertisingMetricsPanel } from './AdvertisingMetricsPanel'
import type { MarketingFunnelReport } from '@/services/marketingFunnel.service'
import type { PanelFilters } from '@/services/advertisingPanel.logic'
import type { AdsConnectionProbe } from '@/app/inmobiliaria/marketing/metricas/actions'

export function MarketingFunnelMetricsView({report,error,initialFilters}:{
 report:MarketingFunnelReport|null; error?:string|null; initialFilters?:PanelFilters;
 projects:{id:string;name:string}[]; selectedProjectId:string;
 adsProbe?:AdsConnectionProbe|null;
 adsInsights?:{connected:boolean;message:string;note:string;missing?:string[];currency?:string|null;timezone?:string|null;fetchedAt?:string|null;adAccountId?:string;liveVerified?:boolean;error?:string|null}|null;
}) {
 return <div className="min-w-0 space-y-4">
   <PageHeader eyebrow="Marketing" title="Métricas embudo" description="Gasto publicitario y seguimiento de los contactos que trajo cada anuncio." />
   {report?<AdvertisingMetricsPanel key={report.period.from+':'+report.period.to} report={report} initialFilters={initialFilters} />:
     <p role="status" className="rounded-xl border border-[#e9e1d5] bg-[#faf8f4] p-5 text-sm">{error?'No se pudo consultar el informe. No hay cifras verificables para mostrar. Vuelve a intentar la consulta.':'No hay un informe disponible para estas fechas.'}</p>}
 </div>
}
