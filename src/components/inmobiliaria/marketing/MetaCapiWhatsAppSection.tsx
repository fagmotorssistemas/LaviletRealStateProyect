'use client'

import Link from 'next/link'
import type { MetaWhatsAppVisibility } from '@/services/metaCapiOutbox.service'
import { cn } from '@/lib/utils'
import {
  WA_ADS_CONSENT_EXPECTED_REPLY,
  WA_ADS_CONSENT_REQUEST_SCRIPT,
} from '@/lib/meta/waLeadSubmittedConsentRequest'

function formatWhen(iso: string | null | undefined, timeZone: string) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-EC', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function MiniKpi({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-2.5 py-2" title={hint}>
      <p className="text-[9px] font-semibold leading-tight tracking-[0.12em] text-[#8a8176] uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-[#1f1a14]">{value}</p>
    </div>
  )
}

export function MetaCapiWhatsAppSection({
  whatsapp,
  tz,
}: {
  whatsapp: MetaWhatsAppVisibility
  tz: string
}) {
  const s = whatsapp.periodSummary
  const conv = whatsapp.conversions

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#ece6dc] bg-white p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#1f1a14]">WhatsApp / CRM</h2>
            <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6b645c]">
              {whatsapp.disclaimer}
            </p>
          </div>
          <p className="text-[10px] text-[#8a8176]">
            Periodo:{' '}
            {whatsapp.period.dateFrom || whatsapp.period.dateTo
              ? `${whatsapp.period.dateFrom || '…'} → ${whatsapp.period.dateTo || '…'}`
              : 'sin filtro de fecha (todos)'}
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <MiniKpi
            label="Msgs entrantes"
            value={s.inboundMessages}
            hint={whatsapp.indicatorHelp[0]}
          />
          <MiniKpi
            label="Contactos únicos"
            value={s.uniqueContacts}
            hint={whatsapp.indicatorHelp[1]}
          />
          <MiniKpi
            label="Con CTWA"
            value={s.contactsWithCtwa}
            hint={whatsapp.indicatorHelp[2]}
          />
          <MiniKpi
            label="Sin CTWA"
            value={s.contactsWithoutCtwa}
            hint={whatsapp.indicatorHelp[3]}
          />
          <MiniKpi
            label="Última recepción"
            value={s.lastReceptionAt ? formatWhen(s.lastReceptionAt, tz) : '—'}
            hint={whatsapp.indicatorHelp[4]}
          />
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-[#8a8176]">{whatsapp.ctwa.note}</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[10px] text-[#8a8176]">
          {whatsapp.indicatorHelp.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-[11px]">
            <thead className="border-b border-[#ece6dc] text-[10px] tracking-[0.08em] text-[#8a8176] uppercase">
              <tr>
                <th className="px-2 py-2 font-semibold">Contacto</th>
                <th className="px-2 py-2 font-semibold">Último inbound</th>
                <th className="px-2 py-2 font-semibold">Msgs</th>
                <th className="px-2 py-2 font-semibold">Origen CRM</th>
                <th className="px-2 py-2 font-semibold">Atribución</th>
                <th className="px-2 py-2 font-semibold">Anuncio CTWA</th>
                <th className="px-2 py-2 font-semibold">Ficha</th>
              </tr>
            </thead>
            <tbody>
              {whatsapp.contactDetails.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-[#8a8176]">
                    Sin mensajes entrantes WhatsApp en el periodo y alcance.
                  </td>
                </tr>
              ) : (
                whatsapp.contactDetails.map((row) => (
                  <tr key={row.leadId} className="border-b border-[#f0ebe3] align-top">
                    <td className="px-2 py-2">
                      <p className="font-medium text-[#1f1a14]">{row.name || 'Sin nombre'}</p>
                      <p className="tabular-nums text-[#6b645c]">{row.phone || '—'}</p>
                      {row.technicalProbe ? (
                        <p className="mt-1 text-[10px] text-amber-800" title={whatsapp.indicatorHelp[5]}>
                          Prueba técnica (mensaje): {row.technicalProbe.label}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-[#6b645c]">{formatWhen(row.lastInboundAt, tz)}</td>
                    <td className="px-2 py-2 tabular-nums">{row.inboundCount}</td>
                    <td className="px-2 py-2 text-[#6b645c]">
                      {row.crmOriginLabel}
                      <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                        ≠ prueba de ctwa_clid
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                          row.attributionStatus === 'confirmed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-700',
                        )}
                      >
                        {row.attributionStatus === 'confirmed' ? 'CTWA confirmada' : 'Sin CTWA'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-[#6b645c]">
                      {row.ctwaSourceId ? (
                        <>
                          <span className="font-mono text-[10px]">{row.ctwaSourceId}</span>
                          {row.ctwaReferralSourceType ? (
                            <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                              {row.ctwaReferralSourceType}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Link
                        href={row.leadHref}
                        className="font-semibold text-[#5b4a9a] underline-offset-2 hover:underline"
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#ece6dc] bg-white p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-[#1f1a14]">Conversiones WhatsApp</h2>
        {conv.banner ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900">
            {conv.banner}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-[#6b645c]">
          Feature {conv.featureEnabled ? 'ON' : 'OFF'} · Delivery {conv.deliveryEnabled ? 'ON' : 'OFF'}.
          Registros reales de evaluation/bloqueo/cola; sin filas inventadas.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MiniKpi label="Evaluado" value={conv.kpis.evaluated} />
          <MiniKpi label="Bloqueado" value={conv.kpis.blocked} />
          <MiniKpi label="Encolado" value={conv.kpis.enqueued} />
          <MiniKpi label="Nest aceptó" value={conv.kpis.backendAccepted} />
          <MiniKpi label="Meta aceptó" value={conv.kpis.metaAccepted} />
          <MiniKpi label="Meta rechazó" value={conv.kpis.metaRejected} />
        </div>
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[10px] text-[#8a8176]">
          {conv.indicatorHelp.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-[11px]">
            <thead className="border-b border-[#ece6dc] text-[10px] tracking-[0.08em] text-[#8a8176] uppercase">
              <tr>
                <th className="px-2 py-2 font-semibold">Fecha</th>
                <th className="px-2 py-2 font-semibold">Lead</th>
                <th className="px-2 py-2 font-semibold">Evento</th>
                <th className="px-2 py-2 font-semibold">Etapa</th>
                <th className="px-2 py-2 font-semibold">Motivo</th>
                <th className="px-2 py-2 font-semibold">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {conv.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-[#8a8176]">
                    Sin registros LeadSubmitted en el periodo.
                  </td>
                </tr>
              ) : (
                conv.rows.map((row) => (
                  <tr key={row.id} className="border-b border-[#f0ebe3] align-top">
                    <td className="px-2 py-2 text-[#6b645c]">{formatWhen(row.createdAt, tz)}</td>
                    <td className="px-2 py-2">
                      {row.leadHref ? (
                        <Link
                          href={row.leadHref}
                          className="font-semibold text-[#5b4a9a] underline-offset-2 hover:underline"
                        >
                          {row.phoneMasked || 'Sin teléfono'}
                        </Link>
                      ) : (
                        <span className="text-[#8a8176]">{row.phoneMasked || 'Sin lead'}</span>
                      )}
                      {row.leadId ? (
                        <span className="mt-0.5 block font-mono text-[9px] text-[#8a8176]">
                          {row.leadId.slice(0, 8)}…
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      {row.eventName}
                      {row.isTechnicalProbe ? (
                        <span className="mt-0.5 block text-[10px] text-amber-800">Probe técnico</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">{row.stageLabel}</td>
                    <td className="px-2 py-2 text-[#6b645c]">{row.reasonLabel}</td>
                    <td className="px-2 py-2 text-[#6b645c]">
                      {row.pipelineStep === 'evaluated_or_blocked' && 'Mensaje / evaluación'}
                      {row.pipelineStep === 'enqueued' && 'Cola local'}
                      {row.pipelineStep === 'backend_accepted' && 'Entrega Nest'}
                      {row.pipelineStep === 'meta_accepted' && 'Aceptación Meta'}
                      {row.pipelineStep === 'meta_rejected' && 'Rechazo Meta'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#ece6dc] bg-white p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-[#1f1a14]">Consentimiento Meta (WhatsApp ads)</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-[#6b645c]">
          No se envía por el bot. Si la bitácora bloquea por{' '}
          <code className="text-[10px]">ads_consent_*</code>, el asesor copia este
          texto y lo envía manualmente en Kommo. La respuesta del cliente debe
          mencionar medición/publicidad de Meta (alcance{' '}
          <code className="text-[10px]">whatsapp_ads</code>).
        </p>
        <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-[11px] leading-relaxed text-[#1f1a14]">
          {WA_ADS_CONSENT_REQUEST_SCRIPT}
        </pre>
        <p className="mt-2 text-[10px] text-[#8a8176]">
          Respuesta esperada:{' '}
          <span className="font-medium text-[#6b645c]">
            «{WA_ADS_CONSENT_EXPECTED_REPLY}»
          </span>
        </p>
      </section>
    </div>
  )
}
