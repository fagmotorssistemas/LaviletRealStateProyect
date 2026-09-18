import { Radio } from 'lucide-react'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import {
  isMetaCapiSentStage,
  isMetaCapiProbeRow,
  labelMetaCapiReason,
  labelMetaCapiStage,
} from '@/lib/meta/capiConversionLogLabels'
import { listMetaCapiConversionLog } from './actions'

function resolveCapiLogDataSource(): {
  host: string
  isLocal: boolean
  label: string
} {
  const raw = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  let host = '(sin NEXT_PUBLIC_SUPABASE_URL)'
  try {
    host = new URL(raw).host
  } catch {
    /* keep fallback */
  }
  const isLocal =
    host === '127.0.0.1:54321' ||
    host === 'localhost:54321' ||
    host.startsWith('127.0.0.1:') ||
    host.startsWith('localhost:')
  return {
    host,
    isLocal,
    label: isLocal
      ? `Base local · ${host}`
      : `Base remota · ${host} (no es el Supabase local de la sonda)`,
  }
}

export default async function MarketingCapiPage() {
  const dataSource = resolveCapiLogDataSource()
  const result = await listMetaCapiConversionLog({ limit: 150 })

  if (!result.ok) {
    return (
      <div className="crm-page">
        <PageHeader
          eyebrow="Marketing / CAPI"
          title="Bitácora CAPI"
          description="No se pudo cargar meta_capi_conversion_log."
        />
        <p style={{ fontSize: '0.8rem', marginBottom: '1rem', color: 'var(--crm-muted, #666)' }}>
          Origen de datos: {dataSource.label}
        </p>
        <EmptyState
          icon={Radio}
          title="Sin acceso o tabla ausente"
          description={result.error}
        />
      </div>
    )
  }

  const rows = result.rows
  const evaluated = rows.filter((r) => r.stage === 'evaluated').length
  const blocked = rows.filter((r) => r.stage === 'blocked').length
  const enqueued = rows.filter((r) => r.stage === 'enqueued' || r.stage === 'backend_accepted').length
  const sent = rows.filter((r) => isMetaCapiSentStage(r.stage)).length
  const rejected = rows.filter((r) => r.stage === 'meta_rejected').length
  const byEventName = Object.entries(
    rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.event_name] = (acc[row.event_name] || 0) + 1
      return acc
    }, {}),
  ).sort((a, b) => b[1] - a[1])

  return (
    <div className="crm-page">
      <PageHeader
        eyebrow="Marketing / CAPI"
        title="Bitácora CAPI"
        description="Evaluaciones no cuentan como conversiones enviadas. La aceptación de Meta exige respuesta correlacionada (event_id + fbtrace)."
      />

      <p
        style={{
          fontSize: '0.8rem',
          marginBottom: '1rem',
          padding: '0.5rem 0.75rem',
          border: '1px solid var(--crm-border, #e5e5e5)',
          borderRadius: 4,
          color: dataSource.isLocal ? 'var(--crm-text, #222)' : '#8a4b00',
          background: dataSource.isLocal ? 'transparent' : '#fff8e8',
        }}
      >
        Origen de datos: <strong>{dataSource.label}</strong>
        {!dataSource.isLocal
          ? ' — Las pruebas de sonda se guardan en Supabase local (127.0.0.1:54321); esta pantalla no las mostrará.'
          : null}
      </p>

      <div
        className="crm-stats-row"
        style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}
      >
        <div>
          <div className="crm-eyebrow">Evaluadas</div>
          <strong>{evaluated}</strong>
        </div>
        <div>
          <div className="crm-eyebrow">Bloqueadas</div>
          <strong>{blocked}</strong>
        </div>
        <div>
          <div className="crm-eyebrow">En tránsito</div>
          <strong>{enqueued}</strong>
        </div>
        <div>
          <div className="crm-eyebrow">Aceptadas Meta</div>
          <strong>{sent}</strong>
        </div>
        <div>
          <div className="crm-eyebrow">Rechazadas Meta</div>
          <strong>{rejected}</strong>
        </div>
      </div>

      {byEventName.length > 0 ? (
        <p style={{ fontSize: '0.8rem', marginBottom: '1rem', color: 'var(--crm-muted, #666)' }}>
          Por event_name (página actual):{' '}
          {byEventName.map(([name, count]) => `${name}=${count}`).join(' · ')}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="Sin filas aún"
          description="Cuando el feature esté activo, aquí aparecerán evaluaciones, bloqueos y aceptaciones Meta."
        />
      ) : (
        <div className="crm-table-wrap" style={{ overflowX: 'auto' }}>
          <table
            className="crm-table"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}
          >
            <thead>
              <tr>
                <th align="left">Fecha</th>
                <th align="left">Evento</th>
                <th align="left">Carril</th>
                <th align="left">Etapa</th>
                <th align="left">Motivo</th>
                <th align="left">event_id</th>
                <th align="left">Lead / contacto</th>
                <th align="left">Correlación Meta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const fbtrace =
                  typeof row.details.fbtrace_id === 'string' ? row.details.fbtrace_id : null
                const eventsReceived =
                  typeof row.details.events_received === 'number'
                    ? row.details.events_received
                    : null
                const probe = isMetaCapiProbeRow(row)
                const lane = row.delivery_lane || '—'
                return (
                  <tr key={row.id} style={{ borderTop: '1px solid var(--crm-border, #e5e5e5)' }}>
                    <td>{new Date(row.created_at).toLocaleString('es-EC')}</td>
                    <td>
                      {row.event_name}
                      {probe ? (
                        <span
                          style={{
                            marginLeft: '0.5rem',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            letterSpacing: '0.04em',
                            color: 'var(--crm-muted, #666)',
                          }}
                        >
                          PRUEBA
                        </span>
                      ) : null}
                    </td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>
                      {lane}
                      {probe ? ' · aislada' : ''}
                    </td>
                    <td>{labelMetaCapiStage(row.stage)}</td>
                    <td>{labelMetaCapiReason(row.reason)}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>
                      {row.event_id || '—'}
                    </td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>
                      {probe
                        ? '— (sin cliente real)'
                        : `${row.lead_id || '—'}${row.contact_id ? ` / ${row.contact_id}` : ''}`}
                    </td>
                    <td style={{ fontSize: '0.75rem' }}>
                      {fbtrace || eventsReceived != null
                        ? `fbtrace=${fbtrace || '—'}; received=${eventsReceived ?? '—'}`
                        : isMetaCapiSentStage(row.stage)
                          ? 'Sin correlación (revisar Nest)'
                          : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
