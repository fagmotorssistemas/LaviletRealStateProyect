import { fetchMarketingFunnelMetrics } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Embudo interno (server). UI detallada la arma Cursor frontend.
 * No dispara CAPI.
 */
export default async function MarketingMetricasPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const sp = await searchParams
  const from = sp.from || '2026-09-21'
  const to = sp.to || new Date().toISOString().slice(0, 10)
  const result = await fetchMarketingFunnelMetrics({ period: { from, to } })

  if (!result.ok) {
    return (
      <main style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1>Métricas embudo</h1>
        <p>Error: {result.error}</p>
      </main>
    )
  }

  const { totals, byAttributedAd, limitations } = result.data
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 960 }}>
      <h1>Métricas embudo</h1>
      <p>
        Período Ecuador {from} → {to}. Informes internos; gates Meta intactos.
      </p>
      <h2>Totales</h2>
      <ul>
        <li>Leads adquiridos: {totals.leadsAcquiredInPeriod}</li>
        <li>Con atribución CTWA: {totals.leadsWithAttribution}</li>
        <li>Sin atribución: {totals.leadsWithoutAttribution}</li>
        <li>
          Temperatura F/T/C/SC:{' '}
          {totals.temperature.frio}/{totals.temperature.tibio}/
          {totals.temperature.caliente}/{totals.temperature.sin_clasificar}
        </li>
        <li>
          Citas ocurridas (start_time): {totals.appointmentsOccurredInPeriod}{' '}
          · leads con cita: {totals.leadsWithAppointmentInPeriod}
        </li>
        <li>
          Ventas (sale_at): {totals.salesOccurredInPeriod} · importe:{' '}
          {totals.salesAmountInPeriod ?? 'n/d'} ({totals.salesCurrency})
        </li>
        <li>
          Contratos anulados (signed_at||created_at):{' '}
          {totals.contractsAnulledInPeriod}
        </li>
      </ul>
      <h2>Anuncios atribuidos (CTWA source_id)</h2>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
        {JSON.stringify(byAttributedAd.slice(0, 20), null, 2)}
      </pre>
      <h2>Limitaciones</h2>
      <ul>
        {limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </main>
  )
}
