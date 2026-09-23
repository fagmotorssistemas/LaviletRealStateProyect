import { MetricHelp } from './MetricHelp'
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
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 tabular-nums text-[#6b645c]">
      <span>Fríos: {temperature.frio}</span>
      <span>Tibios: {temperature.tibio}</span>
      <span>Calientes: {temperature.caliente}</span>
      <span>Sin clasificar: {temperature.sin_clasificar}</span>
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
    <MetricHelp
      className="w-full text-left cursor-help rounded-2xl border border-[#ece6dc] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(40,30,20,0.04)]"
      explanation={title || hint || label}
    >
      <span className="block text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
        {label}
      </span>
      <span className="block mt-1 text-2xl font-semibold tabular-nums text-[#1f1a14]">{value}</span>
      {hint ? <span className="block mt-1 text-[11px] leading-snug text-[#8a8176]">{hint}</span> : null}
    </MetricHelp>
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


  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Resultados de publicidad y ventas"
        description="Consulta cuánto gastas en publicidad, cuántas personas se interesan y cuántas llegan a comprar. Horario de Ecuador."
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
          <p className="font-semibold text-[#1f1a14]">{adsInsights.liveVerified ? 'Datos de publicidad conectados con Meta' : 'Datos publicitarios pendientes de verificación'}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#8a8176]">
            No se pudo completar el informe. Revisa la conexión o inténtalo de nuevo.
            {adsProbe?.currency || adsInsights.currency
              ? ` · Moneda ${adsProbe?.currency || adsInsights.currency}`
              : ''}
            {adsProbe?.timezone || adsInsights.timezone
              ? ` · Zona horaria ${adsProbe?.timezone || adsInsights.timezone}`
              : ''}
          </p>
          {adsInsights.missing?.length ? (
            <p className="mt-2 text-[11px] text-[#8a8176]">
              La conexión con Meta necesita configuración. Contacta al administrador.
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
              hint={`Del ${from} al ${to}. Contactos según su fecha de registro; citas según la fecha de la visita; ventas según su fecha de confirmación.`}
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                label="Contactos nuevos"
                title="Personas registradas durante las fechas seleccionadas. Una persona interesada todavía no es una venta."
                value={report.totals.leadsAcquiredInPeriod}
                hint="Registrados en las fechas seleccionadas"
              />
              <Kpi
                label="Desde anuncios de WhatsApp"
                title="Contactos cuyo primer origen guardado es un anuncio que abre WhatsApp. Cada contacto se cuenta una vez."
                value={report.totals.leadsWithAttribution}
                hint="Según el primer origen registrado"
              />
              <Kpi
                label="Sin anuncio identificado"
                title="Contactos sin un anuncio de origen registrado. Esto no significa que no hayan visto publicidad."
                value={report.totals.leadsWithoutAttribution}
              />
              <Kpi
                label="Nivel de interés"
                title="Clasificación guardada de los contactos: fríos, tibios, calientes o sin clasificar. Sirve para organizar el seguimiento; no confirma una compra."
                value={`${report.totals.temperature.frio} fríos · ${report.totals.temperature.tibio} tibios`}
                hint={`${report.totals.temperature.caliente} calientes · ${report.totals.temperature.sin_clasificar} sin clasificar`}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                label="Citas programadas"
                value={ap?.scheduled ?? 0}
                hint="Agendadas, todavía no realizadas"
                title="Visitas agendadas para las fechas seleccionadas que aún figuran como programadas."
              />
              <Kpi
                label="Citas realizadas"
                value={ap?.completed ?? 0}
                hint="Visitas marcadas como completadas"
                title="Visitas marcadas como realizadas cuya fecha está dentro del período seleccionado."
              />
              <Kpi
                label="Canceladas / no asistieron"
                value={`${ap?.cancelled ?? 0} / ${ap?.noShow ?? 0}`}
                title="El primer número corresponde a citas canceladas. El segundo, a citas en las que la persona no asistió. Se usa la fecha prevista de la visita."
              />
              <Kpi
                label="Ventas confirmadas"
                title="Ventas confirmadas durante las fechas seleccionadas. El importe suma los valores conocidos; si falta información, no se considera cero."
                value={report.totals.salesOccurredInPeriod}
                hint={`Importe: ${formatAmount(report.totals.salesAmountInPeriod, report.totals.salesCurrency)}`}
              />
            </div>
            <p className="mt-3 rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-[12px] text-[#6b645c]">
              Contratos que actualmente están anulados:{' '}
              <span className="font-semibold text-[#1f1a14]">
                {report.totals.contractsCurrentlyAnulled}
              </span>
              . Fecha de anulación desconocida
              {report.totals.contractsAnulledAnnulmentDateKnown
                ? ''
                : ' (no se puede determinar en qué período se anularon)'}
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
              title="Visitas e interés por inmueble"
              hint="Actividad de los inmuebles del proyecto. Las citas por inmueble pertenecen a los contactos del informe y pueden tener fechas fuera del período. Por eso pueden diferir del total de citas de arriba."
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
        description="No hay actividad de inmuebles para esta selección."
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
          title="Citas o reservas de los contactos del informe que no tienen un inmueble identificado."
        >
          Contactos con citas o reservas sin inmueble identificado — citas:{' '}
          <strong>{undetermined.appointmentLeads}</strong> · reservas:{' '}
          <strong>{undetermined.reservedLeads}</strong>
          {undetermined.note ? (
            <span className="mt-1 block text-[11px] text-amber-900/80">
              Las citas pueden estar fuera de las fechas seleccionadas; aquí se agrupan por contacto.
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
            <th className="px-2 py-2 font-semibold">Visitas al recorrido virtual</th>
            <th className="px-2 py-2 font-semibold">Contactos interesados</th>
            <th className="px-2 py-2 font-semibold">Citas</th>
            <th className="px-2 py-2 font-semibold">Reservas</th>
            <th className="px-2 py-2 font-semibold">Ventas</th>
            <th className="px-2 py-2 font-semibold">Importe</th>
            <th className="px-2 py-2 font-semibold">Nivel de interés</th>
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
              <td className="px-2 py-2">No disponible</td>
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
