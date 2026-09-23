import { BarChart3, Layers } from 'lucide-react'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { MarketingCommercialBoard } from '@/components/inmobiliaria/marketing/MarketingCommercialBoard'
import { cn } from '@/lib/utils'
import type { AdsConnectionProbe } from '@/app/inmobiliaria/marketing/metricas/actions'
import type {
  MarketingFunnelReport,
  UnitFunnelRow,
} from '@/services/marketingFunnel.service'

type ProjectOption = { id: string; name: string }

function formatAmount(value: number | null | undefined, currency?: string | null) {
  if (value == null) return 'No disponible'
  const code = (currency || 'USD').trim().toUpperCase() || 'USD'
  try {
    return new Intl.NumberFormat('es-EC', {
      style: 'currency',
      currency: /^[A-Z]{3}$/.test(code) ? code : 'USD',
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value} ${code}`
  }
}

function TempInline({
  temperature,
}: {
  temperature: MarketingFunnelReport['totals']['temperature']
}) {
  return (
    <span className="tabular-nums text-[#6b645c]">
      F {temperature.frio} · T {temperature.tibio} · C {temperature.caliente} · SC{' '}
      {temperature.sin_clasificar}
    </span>
  )
}

function Kpi({
  label,
  value,
  hint,
  title,
}: {
  label: string
  value: string | number
  hint?: string
  title?: string
}) {
  return (
    <div
      className="rounded-2xl border border-[#ece6dc] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(40,30,20,0.04)]"
      title={title}
    >
      <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1a14]">{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-[#8a8176]">{hint}</p> : null}
    </div>
  )
}

function SectionTitle({
  title,
  hint,
}: {
  title: string
  hint?: string
}) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-[#1f1a14]">{title}</h2>
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-[#8a8176]">{hint}</p> : null}
    </div>
  )
}

export function MarketingFunnelMetricsView({
  report,
  error,
  adsInsights,
  adsProbe,
}: {
  report: MarketingFunnelReport | null
  projects: ProjectOption[]
  selectedProjectId: string
  error?: string | null
  adsInsights?: {
    connected: boolean
    message: string
    note: string
    missing?: string[]
    currency?: string | null
    timezone?: string | null
    fetchedAt?: string | null
    adAccountId?: string
    liveVerified?: boolean
    error?: string | null
  } | null
  adsProbe?: AdsConnectionProbe | null
}) {
  const from = report?.period.from ?? ''
  const to = report?.period.to ?? ''
  const ap = report?.totals.appointmentsInPeriod
  const undeterminedNote =
    report?.undeterminedUnit.note ||
    'undeterminedUnit = cohorte sin appointment_units (≠ citas del período por start_time).'

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Métricas embudo"
        description="Informe interno CTWA / CRM · America/Guayaquil. No dispara CAPI ni Pixel."
      />

      {!report && adsInsights ? (
        <div
          className={cn(
            'rounded-2xl border px-4 py-3 text-sm',
            adsInsights.connected
              ? 'border-[#ece6dc] bg-[#faf8f5] text-[#5c5348]'
              : 'border-[#e8d9c4] bg-[#fff8ef] text-[#5c5348]',
          )}
        >
          <p className="font-semibold text-[#1f1a14]">{adsInsights.message}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#8a8176]">
            {adsInsights.note}
            {adsProbe?.currency || adsInsights.currency
              ? ` · Moneda ${adsProbe?.currency || adsInsights.currency}`
              : ''}
            {adsProbe?.timezone || adsInsights.timezone
              ? ` · TZ ${adsProbe?.timezone || adsInsights.timezone}`
              : ''}
          </p>
          {adsInsights.missing?.length ? (
            <p className="mt-2 text-[11px] text-[#8a8176]">
              Faltan: {adsInsights.missing.join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {!report && !error ? (
        <EmptyState
          icon={BarChart3}
          title="Sin datos"
          description="Ajuste el período y vuelva a consultar."
        />
      ) : null}

      {report ? (
        <>
          <section>
            <SectionTitle
              title="Totales"
              hint={`Cohorte leads · created_at ∈ ${from} → ${to}. Citas totales por start_time del período; ventas por sale_at.`}
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                label="Leads adquiridos"
                value={report.totals.leadsAcquiredInPeriod}
                hint="Cohorte created_at ∈ período"
              />
              <Kpi
                label="Con CTWA"
                value={report.totals.leadsWithAttribution}
                hint="Atribución first-touch"
              />
              <Kpi
                label="Sin atribución"
                value={report.totals.leadsWithoutAttribution}
              />
              <Kpi
                label="Temperatura"
                value={`${report.totals.temperature.frio}/${report.totals.temperature.tibio}/${report.totals.temperature.caliente}/${report.totals.temperature.sin_clasificar}`}
                hint="F / T / C / sin clasificar"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                label="Citas programadas"
                value={ap?.scheduled ?? 0}
                hint="start_time ∈ período · no = realizadas"
                title={`${undeterminedNote} La fila “unidad no determinada” es cohorte sin appointment_units, no este KPI.`}
              />
              <Kpi
                label="Citas realizadas"
                value={ap?.completed ?? 0}
                hint="Completadas (no cancel/futura)"
                title={`${undeterminedNote} Distinto de undeterminedUnit (cohorte sin appointment_units).`}
              />
              <Kpi
                label="Cancel / no-show"
                value={`${ap?.cancelled ?? 0} / ${ap?.noShow ?? 0}`}
                title={undeterminedNote}
              />
              <Kpi
                label="Ventas del período"
                value={report.totals.salesOccurredInPeriod}
                hint={`Importe: ${formatAmount(report.totals.salesAmountInPeriod, report.totals.salesCurrency)}`}
              />
            </div>
            <p className="mt-3 rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-[12px] text-[#6b645c]">
              Contratos anulados (snapshot actual):{' '}
              <span className="font-semibold text-[#1f1a14]">
                {report.totals.contractsCurrentlyAnulled}
              </span>
              . Fecha de anulación desconocida
              {report.totals.contractsAnulledAnnulmentDateKnown
                ? ''
                : ' (no se inventa con signed_at)'}
              .
            </p>
          </section>

          <MarketingCommercialBoard
            report={report}
            adsInsights={adsInsights}
            adsProbe={adsProbe}
          />

          <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
            <SectionTitle
              title="Por unidad (showroom / citas)"
              hint="Solo unidades con showroom o citas en el alcance del project. Reserva = titular comprobado; sin titular único → “titular no determinado”. La fila separada de citas/reservas sin unidad usa la cohorte de leads, no el KPI de citas por start_time del período."
            />
            <UnitTable
              rows={report.byUnit}
              undetermined={report.undeterminedUnit}
              undeterminedTitularUnits={report.undeterminedTitularUnits}
            />
          </section>

        </>
      ) : null}
    </div>
  )
}

function UnitTable({
  rows,
  undetermined,
  undeterminedTitularUnits,
}: {
  rows: UnitFunnelRow[]
  undetermined: MarketingFunnelReport['undeterminedUnit']
  undeterminedTitularUnits: number
}) {
  const hasUndetermined =
    undetermined.appointmentLeads > 0 || undetermined.reservedLeads > 0
  if (rows.length === 0 && !hasUndetermined) {
    return (
      <EmptyState
        icon={Layers}
        title="Sin unidades"
        description="No hay filas de unidad en el período / alcance."
      />
    )
  }
  return (
    <div className="overflow-x-auto">
      {hasUndetermined ? (
        <p
          className={cn(
            'mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950',
          )}
          title={undetermined.note}
        >
          Unidad no determinada (citas de cohorte) — citas:{' '}
          <strong>{undetermined.appointmentLeads}</strong> · reservas:{' '}
          <strong>{undetermined.reservedLeads}</strong>
          {undetermined.note ? (
            <span className="mt-1 block text-[11px] text-amber-900/80">
              {undetermined.note}
            </span>
          ) : null}
        </p>
      ) : null}
      {undeterminedTitularUnits > 0 ? (
        <p
          className={cn(
            'mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950',
          )}
        >
          Titular no determinado — unidades reservadas sin titular único:{' '}
          <strong>{undeterminedTitularUnits}</strong>
        </p>
      ) : null}
      <table className="min-w-full text-left text-[11px]">
        <thead className="border-b border-[#ece6dc] text-[10px] tracking-[0.08em] text-[#8a8176] uppercase">
          <tr>
            <th className="px-2 py-2 font-semibold">Unidad</th>
            <th className="px-2 py-2 font-semibold">Showroom</th>
            <th className="px-2 py-2 font-semibold">Interés com.</th>
            <th className="px-2 py-2 font-semibold">Citas</th>
            <th className="px-2 py-2 font-semibold">Reservas</th>
            <th className="px-2 py-2 font-semibold">Ventas</th>
            <th className="px-2 py-2 font-semibold">Importe</th>
            <th className="px-2 py-2 font-semibold">F/T/C/SC</th>
          </tr>
        </thead>
        <tbody>
          {hasUndetermined ? (
            <tr className="border-b border-[#f0ebe3] bg-amber-50/40 align-top">
              <td className="px-2 py-2 font-medium text-amber-950">
                Unidad no determinada
              </td>
              <td className="px-2 py-2 tabular-nums">—</td>
              <td className="px-2 py-2 tabular-nums">—</td>
              <td className="px-2 py-2 tabular-nums">
                {undetermined.appointmentLeads}
              </td>
              <td className="px-2 py-2 tabular-nums">
                {undetermined.reservedLeads}
              </td>
              <td className="px-2 py-2 tabular-nums">—</td>
              <td className="px-2 py-2">n/d</td>
              <td className="px-2 py-2">—</td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr
              key={row.unitId || row.unitLabel}
              className="border-b border-[#f0ebe3] align-top"
            >
              <td className="px-2 py-2 text-[#1f1a14]">
                <span className="font-medium">{row.unitLabel}</span>
                {row.category ? (
                  <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                    {row.category}
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-2 tabular-nums">{row.showroomViews}</td>
              <td className="px-2 py-2 tabular-nums">
                {row.commercialInterestLeads}
              </td>
              <td className="px-2 py-2 tabular-nums">{row.appointmentLeads}</td>
              <td className="px-2 py-2">
                {row.reservationTitularUndetermined ? (
                  <span className="font-medium text-amber-900">
                    titular no determinado
                  </span>
                ) : (
                  <span className="tabular-nums">{row.reservedLeads}</span>
                )}
              </td>
              <td className="px-2 py-2 tabular-nums">{row.salesConfirmed}</td>
              <td className="px-2 py-2 tabular-nums">
                {formatAmount(row.salesAmount)}
              </td>
              <td className="px-2 py-2">
                <TempInline temperature={row.temperature} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
