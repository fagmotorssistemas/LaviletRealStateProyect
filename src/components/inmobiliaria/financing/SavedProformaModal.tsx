'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils'
import {
  FINANCING_TYPE_OPTIONS,
  LEAD_FINANCING_STATUS_OPTIONS,
  type LeadFinancing,
} from '@/types/inmobiliaria'

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#ece6dc]/80 py-2.5 last:border-b-0">
      <span className="text-sm text-[#6b645c]">{label}</span>
      <span
        className={
          strong
            ? 'crm-num text-base font-semibold text-[#1f1a14]'
            : 'crm-num text-sm font-medium text-[#1f1a14]'
        }
      >
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e4e6df] bg-white px-4 py-2 sm:px-5">
      <p className="pt-2 text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
        {title}
      </p>
      {children}
    </div>
  )
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function fmtM2(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 })} m²`
}

function fmtNum(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return String(value)
}

export function SavedProformaModal({
  open,
  onClose,
  row,
  advisorName,
  advisorPhone,
}: {
  open: boolean
  onClose: () => void
  row: LeadFinancing | null
  advisorName?: string | null
  advisorPhone?: string | null
}) {
  const [downloading, setDownloading] = useState(false)

  if (!row) return null

  const isCash = row.financing_type === 'contado'
  const unitPrice = Number(row.unit_price) || 0
  const entryAmount = Number(row.entry_amount) || 0
  const financed = Number(row.financed_amount) || 0
  const termMonths = Number(row.term_months) || 0
  const rate = Number(row.interest_rate) || 0
  const monthly = Number(row.monthly_payment) || 0
  const entryPct = unitPrice > 0 ? round2((entryAmount / unitPrice) * 100) : 0
  const totalPaid = monthly > 0 && termMonths > 0 ? round2(monthly * termMonths) : financed
  const totalInterest = round2(Math.max(0, totalPaid - financed))
  const years = termMonths > 0 ? round2(termMonths / 12) : 0
  const typeLabel =
    FINANCING_TYPE_OPTIONS.find((o) => o.value === row.financing_type)?.label ??
    row.financing_type ??
    '—'
  const statusLabel =
    LEAD_FINANCING_STATUS_OPTIONS.find((o) => o.value === row.status)?.label ?? row.status
  const partnerLabel = row.partner?.name || (isCash ? 'Pago completo · sin crédito' : typeLabel)
  const issuedAt = new Intl.DateTimeFormat('es-EC', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(row.requested_at))
  const validUntil = new Intl.DateTimeFormat('es-EC', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(new Date(row.requested_at).getTime() + 15 * 24 * 60 * 60 * 1000))
  const floorLabel =
    row.unit?.floor?.trim() ||
    (row.unit?.floor_number != null ? `Piso ${row.unit.floor_number}` : '—')

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const { downloadLeadFinancingProformaPdf } = await import('@/lib/inmobiliaria/proformaPdf')
      await downloadLeadFinancingProformaPdf({
        row,
        advisorName,
        advisorPhone,
      })
      toast.success('PDF descargado')
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : 'No se pudo descargar el PDF')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="Proforma guardada" size="xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#6b645c]">
          Vista previa completa. Descargá el PDF con el mismo detalle.
        </p>
        <Button type="button" onClick={() => void handleDownload()} disabled={downloading}>
          <Download size={16} className="mr-2" aria-hidden />
          {downloading ? 'Generando…' : 'Descargar PDF'}
        </Button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-[#c5c8bc] bg-[#f7f7f3]">
        <div className="border-b border-[#e4e6df] bg-white px-5 py-5 sm:px-8 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/LogoHorizontal.png"
              alt="Lavilet"
              className="h-12 w-auto object-contain sm:h-14"
            />
            <div className="text-right">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                Asesor responsable
              </p>
              <p className="mt-1 text-sm font-semibold text-[#1f1a14]">{advisorName || '—'}</p>
              {advisorPhone ? <p className="text-xs text-[#6b645c]">{advisorPhone}</p> : null}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-2xl font-semibold text-[#1f1a14] sm:text-3xl">
                {isCash ? 'Proforma de compra al contado' : 'Proforma de financiamiento'}
              </h3>
              <p className="mt-1 text-sm text-[#6b645c]">{partnerLabel}</p>
              <p className="mt-1 text-xs text-[#8a8176]">
                Estado: {statusLabel} · Vigencia hasta {validUntil}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#8a8176]">{issuedAt}</p>
              <p className="mt-0.5 text-[10px] tracking-wide text-[#a39a8f] uppercase">
                Ref. {row.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-8 sm:py-6">
          <Section title="Datos del solicitante">
            <Row label="Nombre" value={row.lead?.name ?? '—'} />
            <Row label="Teléfono" value={row.lead?.phone ?? 'Sin teléfono'} />
            <Row label="Email" value={row.lead?.email?.trim() || 'No registrado'} />
            <Row label="Origen" value={row.lead?.source?.trim() || '—'} />
            <Row label="Estado del lead" value={row.lead?.status?.trim() || '—'} />
          </Section>

          <Section title="Datos de la unidad">
            <Row label="Proyecto" value={row.unit?.project?.name ?? '—'} />
            <Row label="Unidad" value={row.unit?.unit_number ?? '—'} />
            <Row label="Categoría" value={row.unit?.category ?? '—'} />
            <Row label="Piso" value={floorLabel} />
            <Row label="Dormitorios" value={fmtNum(row.unit?.bedrooms)} />
            <Row label="Baños" value={fmtNum(row.unit?.bathrooms)} />
            <Row label="Área interna" value={fmtM2(row.unit?.area_internal_m2)} />
            <Row label="Área total" value={fmtM2(row.unit?.area_total_m2)} />
            <Row
              label="Parqueos"
              value={
                row.unit?.parking_assigned != null ? String(row.unit.parking_assigned) : '—'
              }
            />
            <Row
              label="Precio publicado"
              value={
                row.unit?.published_commercial_price != null
                  ? formatCurrency(Number(row.unit.published_commercial_price))
                  : formatCurrency(unitPrice)
              }
            />
          </Section>

          <Section title={isCash ? 'Resumen de compra' : 'Condiciones del crédito'}>
            <Row label="Modalidad" value={isCash ? 'Contado' : typeLabel} />
            {!isCash ? <Row label="Institución" value={partnerLabel} /> : null}
            <Row label="Estado de proforma" value={statusLabel} />
            <Row label="Precio de la unidad" value={formatCurrency(unitPrice)} />
            {isCash ? (
              <>
                <Row label="Forma de pago" value="Contado (100%)" strong />
                <Row label="Saldo a financiar" value={formatCurrency(0)} />
              </>
            ) : (
              <>
                <Row
                  label={`Entrada (${entryPct.toFixed(1)}%)`}
                  value={formatCurrency(entryAmount)}
                />
                <Row label="Monto financiado" value={formatCurrency(financed)} strong />
                <Row label="Plazo" value={`${termMonths} meses · ${years} años`} />
                <Row label="Tasa anual" value={`${rate}%`} />
                <Row label="Cuota mensual" value={formatCurrency(monthly)} strong />
                <Row label="Intereses estimados" value={formatCurrency(totalInterest)} />
                <Row label="Total a pagar en el plazo" value={formatCurrency(totalPaid)} strong />
              </>
            )}
            <Row
              label="Generado por"
              value={row.generated_by === 'asesor' ? 'Asesor CRM' : row.generated_by || '—'}
            />
            <Row label="Vigencia sugerida" value={`Hasta ${validUntil}`} />
          </Section>

          {isCash ? (
            <div className="rounded-xl bg-[#2b1a18] px-5 py-5 text-[#f4f4ef]">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-[#bda27e] uppercase">
                Total a pagar hoy
              </p>
              <p className="crm-num mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                {formatCurrency(unitPrice)}
              </p>
              <p className="mt-2 text-sm text-white/70">Sin cuotas · sin intereses</p>
            </div>
          ) : (
            <div className="rounded-xl bg-[#2b1a18] px-5 py-5 text-[#f4f4ef]">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-[#bda27e] uppercase">
                Cuota mensual fija
              </p>
              <p className="crm-num mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                {formatCurrency(monthly)}
              </p>
              <p className="mt-2 text-sm text-white/70">
                {termMonths} meses ({years} años) · {rate}% anual
              </p>
            </div>
          )}

          {row.notes?.trim() ? (
            <div className="rounded-xl border border-[#e4e6df] bg-white px-4 py-3.5">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                Notas del asesor
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#4a433c]">
                {row.notes}
              </p>
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-[#8a8176]">
            {isCash
              ? 'Proforma referencial de compra al contado. Vigencia sugerida 15 días. No incluye gastos notariales ni de escritura. No constituye oferta vinculante.'
              : 'Proforma referencial. Sujeta a aprobación de la institución, avalúo y políticas de crédito. Vigencia sugerida 15 días. No constituye preaprobación ni oferta vinculante.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
