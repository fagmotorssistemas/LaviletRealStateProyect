import Link from 'next/link'
import { BarChart3, Layers, Megaphone } from 'lucide-react'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { cn } from '@/lib/utils'
import type {
  AttributedAdFunnelRow,
  MarketingFunnelReport,
  UnitFunnelRow,
} from '@/services/marketingFunnel.service'

type ProjectOption = { id: string; name: string }

function formatAmount(value: number | null | undefined, currency?: string) {
  if (value == null) return 'n/d'
  try {
    return new Intl.NumberFormat('es-EC', {
      style: 'currency',
      currency: currency === 'USD' ? 'USD' : 'USD',
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return String(value)
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
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-[#ece6dc] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(40,30,20,0.04)]">
      <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1a14]">{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-[#8a8176]">{hint}</p> : null}
    </div>
  )
}

function adLabel(row: AttributedAdFunnelRow) {
  const sourceId = row.adId || row.attributionKey || 'sin_id'
  const adName = row.adName?.trim()
  const campaign = row.campaignName?.trim()
  const parts = [
    adName ? `Anuncio ${adName}` : `Anuncio CTWA (${sourceId})`,
    campaign ? `Campaña ${campaign}` : null,
    row.adsetName ? `Conjunto ${row.adsetName}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

function resolutionStatusLabel(
  status: AttributedAdFunnelRow['resolutionStatus'],
): string {
  if (status === 'missing_ads_token') return 'Datos publicitarios no disponibles'
  if (status === 'graph_permission_denied') return 'Sin permiso Graph (ads_read)'
  if (status === 'not_found') return 'Anuncio no encontrado'
  if (status === 'resolved') return 'Resuelto'
  return 'Sin resolver'
}

function spendOrCplLabel(
  row: AttributedAdFunnelRow,
  value: number | null | undefined,
): string {
  if (row.resolutionStatus === 'missing_ads_token') {
    return 'Datos publicitarios no disponibles'
  }
  if (value == null) return 'n/d'
  return formatAmount(value, 'USD')
}

function metaResultsLabel(row: AttributedAdFunnelRow): string | number {
  if (row.resolutionStatus === 'missing_ads_token') {
    return 'Datos publicitarios no disponibles'
  }
  return row.metaReportedResults == null ? 'n/d' : row.metaReportedResults
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
  projects,
  selectedProjectId,
  error,
}: {
  report: MarketingFunnelReport | null
  projects: ProjectOption[]
  selectedProjectId: string
  error?: string | null
}) {
  const from = report?.period.from ?? ''
  const to = report?.period.to ?? ''
  const ap = report?.totals.appointmentsInPeriod
  const showProjectSelect = projects.length > 1

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Métricas embudo"
        description="Informe interno CTWA / CRM · America/Guayaquil. No dispara CAPI ni Pixel."
      />

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#ece6dc] bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-[11px] font-semibold tracking-[0.08em] text-[#8a8176] uppercase">
          Desde
          <input
            type="date"
            name="from"
            defaultValue={from}
            required
            className="rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold tracking-[0.08em] text-[#8a8176] uppercase">
          Hasta
          <input
            type="date"
            name="to"
            defaultValue={to}
            required
            className="rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
          />
        </label>
        {showProjectSelect ? (
          <label className="flex min-w-[12rem] flex-col gap-1 text-[11px] font-semibold tracking-[0.08em] text-[#8a8176] uppercase">
            Proyecto
            <select
              name="projectId"
              defaultValue={selectedProjectId}
              className="rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="projectId" value={selectedProjectId} />
        )}
        <button
          type="submit"
          className="rounded-xl bg-[#2B1A18] px-4 py-2 text-sm font-semibold text-[#f7f2ea]"
        >
          Aplicar
        </button>
        <p className="w-full text-[11px] text-[#8a8176]">
          Zona horaria del informe: America/Guayaquil. No mezclar universos en tasas de
          conversión.
        </p>
      </form>

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
              />
              <Kpi
                label="Citas realizadas"
                value={ap?.completed ?? 0}
                hint="Completadas (no cancel/futura)"
              />
              <Kpi
                label="Cancel / no-show"
                value={`${ap?.cancelled ?? 0} / ${ap?.noShow ?? 0}`}
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
                : ' (no se inventa con signed_at)'}.
            </p>
          </section>

          <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
            <SectionTitle
              title="Por anuncio atribuido"
              hint="Etiqueta = Anuncio CTWA (source_id). Adset/campaign suelen ser nulos o graph_permission_denied. Citas = todas las de la cohorte (sin filtro temporal de cita). Ventas = sale_at ∈ período ∧ lead de la cohorte."
            />
            {report.byAttributedAd.length === 0 ? (
              <EmptyState
                icon={Megaphone}
                title="Sin anuncios atribuidos"
                description="No hay leads CTWA en la cohorte del período."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-[11px]">
                  <thead className="border-b border-[#ece6dc] text-[10px] tracking-[0.08em] text-[#8a8176] uppercase">
                    <tr>
                      <th className="px-2 py-2 font-semibold">Anuncio / campaña</th>
                      <th className="px-2 py-2 font-semibold">Leads CRM</th>
                      <th className="px-2 py-2 font-semibold">F/T/C/SC</th>
                      <th className="px-2 py-2 font-semibold">Gasto</th>
                      <th className="px-2 py-2 font-semibold">CPL</th>
                      <th className="px-2 py-2 font-semibold">Meta results</th>
                      <th className="px-2 py-2 font-semibold">Citas sol.</th>
                      <th className="px-2 py-2 font-semibold">Conf.</th>
                      <th className="px-2 py-2 font-semibold">Realiz.</th>
                      <th className="px-2 py-2 font-semibold">Reservas</th>
                      <th className="px-2 py-2 font-semibold">Ventas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byAttributedAd.map((row) => (
                      <tr
                        key={row.attributionKey}
                        className="border-b border-[#f0ebe3] align-top"
                      >
                        <td className="max-w-[18rem] px-2 py-2 text-[#1f1a14]">
                          <span className="font-medium">{adLabel(row)}</span>
                          <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                            {row.adId ? `ad ${row.adId}` : 'sin source_id'}
                            {row.campaignId ? ` · camp ${row.campaignId}` : ''}
                            {' · '}
                            {resolutionStatusLabel(row.resolutionStatus)}
                          </span>
                        </td>
                        <td className="px-2 py-2 tabular-nums">{row.leadsUnique}</td>
                        <td className="px-2 py-2">
                          <TempInline temperature={row.temperature} />
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          {spendOrCplLabel(row, row.adSpend)}
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          {spendOrCplLabel(row, row.costPerLead)}
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          {metaResultsLabel(row)}
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          {row.leadsWithAppointmentRequested}
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          {row.leadsWithAppointmentConfirmed}
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          {row.leadsWithAppointmentDone}
                        </td>
                        <td className="px-2 py-2 tabular-nums">{row.leadsReserved}</td>
                        <td className="px-2 py-2 tabular-nums">{row.salesConfirmed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
            <SectionTitle
              title="Por unidad"
              hint="Solo unidades con showroom o citas en el alcance del project. Reserva = titular comprobado; sin titular único → “titular no determinado”. La fila de unidad no determinada agrupa citas/reservas sin unidad real."
            />
            <UnitTable
              rows={report.byUnit}
              undetermined={report.undeterminedUnit}
              undeterminedTitularUnits={report.undeterminedTitularUnits}
            />
          </section>

          <section className="rounded-2xl border border-dashed border-[#d9d0c3] bg-[#faf8f5] p-4">
            <SectionTitle title="Universos (no mezclar en tasas)" />
            <ul className="space-y-1.5 text-[12px] text-[#6b645c]">
              {Object.entries(report.universes).map(([key, text]) => (
                <li key={key}>
                  <span className="font-semibold text-[#1f1a14]">{key}</span>
                  <span className="text-[#8a8176]"> — {text}</span>
                </li>
              ))}
            </ul>
            <SectionTitle title="Limitaciones" />
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-[#6b645c]">
              {report.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-[#8a8176]">
              Gates Meta intactos ({String(report.metaSendGatesUntouched)}).{' '}
              <Link
                href="/inmobiliaria/marketing/capi"
                className="font-semibold text-[#5b4a9a] underline-offset-2 hover:underline"
              >
                Ir a CAPI Meta
              </Link>
            </p>
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
        >
          Unidad no determinada — citas:{' '}
          <strong>{undetermined.appointmentLeads}</strong> · reservas:{' '}
          <strong>{undetermined.reservedLeads}</strong>
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
