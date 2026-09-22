/**
 * PDF de proforma de financiamiento / contado — documento La Vilet con detalle.
 * Solo llamar desde el cliente. Usa build browser de jsPDF.
 */
import type { LeadFinancing } from '@/types/inmobiliaria'
import { FINANCING_TYPE_OPTIONS, LEAD_FINANCING_STATUS_OPTIONS } from '@/types/inmobiliaria'

const INK = { r: 43, g: 26, b: 24 }
const GOLD = { r: 189, g: 162, b: 126 }
const MUTED = { r: 107, g: 100, b: 92 }
const LINE = { r: 228, g: 221, b: 211 }
const PAPER = { r: 252, g: 250, b: 247 }
const CREAM = { r: 247, g: 243, b: 238 }

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function money(value: number) {
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function safeName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
}

function fmtM2(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return null
  return `${Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 })} m²`
}

function fmtNum(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return null
  return String(value)
}

async function loadJsPdf() {
  const mod = await import('jspdf/dist/jspdf.es.min.js')
  const candidate = mod as {
    jsPDF?: new (options?: object) => import('jspdf').jsPDF
    default?:
      | (new (options?: object) => import('jspdf').jsPDF)
      | { jsPDF: new (options?: object) => import('jspdf').jsPDF }
  }
  if (typeof candidate.jsPDF === 'function') return candidate.jsPDF
  if (typeof candidate.default === 'function') return candidate.default
  if (candidate.default && typeof candidate.default.jsPDF === 'function') {
    return candidate.default.jsPDF
  }
  throw new Error('No se pudo cargar jsPDF')
}

async function loadLogoDataUrl(): Promise<{ data: string; format: 'PNG' | 'JPEG' } | null> {
  try {
    const res = await fetch('/LogoHorizontal.png')
    if (!res.ok) return null
    const blob = await res.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('logo'))
      reader.readAsDataURL(blob)
    })
    return { data: dataUrl, format: 'PNG' }
  } catch {
    return null
  }
}

export async function downloadLeadFinancingProformaPdf(params: {
  row: LeadFinancing
  advisorName?: string | null
  advisorPhone?: string | null
}) {
  const jsPDF = await loadJsPdf()
  const logo = await loadLogoDataUrl()
  const { row, advisorName, advisorPhone } = params

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

  const docTitle = isCash ? 'Proforma de compra al contado' : 'Proforma de financiamiento'
  const highlightLabel = isCash ? 'Total a pagar hoy' : 'Cuota mensual fija'
  const highlightValue = isCash ? money(unitPrice) : money(monthly)
  const highlightHint = isCash
    ? 'Sin cuotas · sin intereses'
    : `${termMonths} meses (${years} años) · ${rate}% anual`

  const floorLabel =
    row.unit?.floor?.trim() ||
    (row.unit?.floor_number != null ? `Piso ${row.unit.floor_number}` : null)
  const unitSpecs: Array<[string, string]> = [
    ['Proyecto', row.unit?.project?.name || '—'],
    ['Unidad', row.unit?.unit_number || '—'],
    ['Categoría', row.unit?.category || '—'],
    ['Piso', floorLabel || '—'],
    ['Dormitorios', fmtNum(row.unit?.bedrooms) || '—'],
    ['Baños', fmtNum(row.unit?.bathrooms) || '—'],
    ['Área interna', fmtM2(row.unit?.area_internal_m2) || '—'],
    ['Área total', fmtM2(row.unit?.area_total_m2) || '—'],
    [
      'Parqueos',
      row.unit?.parking_assigned != null ? String(row.unit.parking_assigned) : '—',
    ],
    [
      'Precio publicado',
      row.unit?.published_commercial_price != null
        ? money(Number(row.unit.published_commercial_price))
        : money(unitPrice),
    ],
  ]

  const leadRows: Array<[string, string]> = [
    ['Nombre', row.lead?.name || '—'],
    ['Teléfono', row.lead?.phone || 'Sin teléfono'],
    ['Email', row.lead?.email?.trim() || 'No registrado'],
    ['Origen', row.lead?.source?.trim() || '—'],
    ['Estado del lead', row.lead?.status?.trim() || '—'],
  ]

  const operationRows: Array<[string, string]> = isCash
    ? [
        ['Modalidad', 'Contado'],
        ['Estado de proforma', statusLabel],
        ['Precio de la unidad', money(unitPrice)],
        ['Entrada / pago', money(entryAmount || unitPrice)],
        ['Porcentaje pagado', '100%'],
        ['Saldo a financiar', money(0)],
        ['Institución', 'No aplica'],
        ['Generado por', row.generated_by === 'asesor' ? 'Asesor CRM' : row.generated_by || '—'],
        ['Fecha de emisión', issuedAt],
        ['Vigencia sugerida', `Hasta ${validUntil}`],
      ]
    : [
        ['Modalidad', typeLabel],
        ['Institución', partnerLabel],
        ['Estado de proforma', statusLabel],
        ['Precio de la unidad', money(unitPrice)],
        [`Entrada (${entryPct.toFixed(1)}%)`, money(entryAmount)],
        ['Monto financiado', money(financed)],
        ['Plazo', `${termMonths} meses · ${years} años`],
        ['Tasa anual', `${rate}%`],
        ['Cuota mensual', money(monthly)],
        ['Intereses estimados', money(totalInterest)],
        ['Total a pagar en el plazo', money(totalPaid)],
        ['Generado por', row.generated_by === 'asesor' ? 'Asesor CRM' : row.generated_by || '—'],
        ['Fecha de emisión', issuedAt],
        ['Vigencia sugerida', `Hasta ${validUntil}`],
      ]

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 16
  const contentW = pageW - margin * 2
  let y = 0

  const ensureSpace = (needed: number) => {
    if (y + needed < pageH - 24) return
    doc.addPage()
    // mini header on continuation
    doc.setFillColor(INK.r, INK.g, INK.b)
    doc.rect(0, 0, pageW, 12, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(GOLD.r, GOLD.g, GOLD.b)
    doc.text('LA VILET · Proforma (continuación)', margin, 8)
    y = 20
  }

  const sectionTitle = (title: string) => {
    ensureSpace(12)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(GOLD.r, GOLD.g, GOLD.b)
    doc.text(title.toUpperCase(), margin, y)
    y += 3.5
    doc.setDrawColor(GOLD.r, GOLD.g, GOLD.b)
    doc.setLineWidth(0.35)
    doc.line(margin, y, margin + 28, y)
    y += 5
  }

  const drawKvTable = (rows: Array<[string, string]>) => {
    const rowH = 7.2
    const tableH = 3 + rows.length * rowH
    ensureSpace(tableH + 4)
    doc.setFillColor(PAPER.r, PAPER.g, PAPER.b)
    doc.setDrawColor(LINE.r, LINE.g, LINE.b)
    doc.setLineWidth(0.2)
    doc.roundedRect(margin, y, contentW, tableH, 1.5, 1.5, 'FD')
    let ry = y + 5.5
    rows.forEach((item, index) => {
      if (index > 0) {
        doc.setDrawColor(LINE.r, LINE.g, LINE.b)
        doc.setLineWidth(0.12)
        doc.line(margin + 3, ry - 3.4, pageW - margin - 3, ry - 3.4)
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
      doc.text(item[0], margin + 4, ry)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(INK.r, INK.g, INK.b)
      doc.text(item[1], pageW - margin - 4, ry, { align: 'right' })
      ry += rowH
    })
    y += tableH + 8
  }

  // —— Header ——
  doc.setFillColor(INK.r, INK.g, INK.b)
  doc.rect(0, 0, pageW, 34, 'F')
  doc.setFillColor(GOLD.r, GOLD.g, GOLD.b)
  doc.rect(0, 34, pageW, 1.3, 'F')

  if (logo) {
    try {
      doc.addImage(logo.data, logo.format, margin, 8, 40, 15, undefined, 'FAST')
    } catch {
      doc.setTextColor(GOLD.r, GOLD.g, GOLD.b)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.text('LA VILET', margin, 18)
    }
  } else {
    doc.setTextColor(GOLD.r, GOLD.g, GOLD.b)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('LA VILET', margin, 18)
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b)
  doc.text('PROFORMA COMERCIAL', pageW - margin, 12, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(CREAM.r, CREAM.g, CREAM.b)
  doc.text(issuedAt, pageW - margin, 19, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b)
  doc.text(`Ref. ${row.id.slice(0, 8).toUpperCase()}`, pageW - margin, 26, { align: 'right' })

  y = 44
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(INK.r, INK.g, INK.b)
  doc.text(docTitle, margin, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text(partnerLabel, margin, y)
  y += 5
  doc.setFontSize(9)
  doc.text(`Estado: ${statusLabel}  ·  Vigencia sugerida hasta ${validUntil}`, margin, y)
  y += 8

  // Asesor
  doc.setFillColor(PAPER.r, PAPER.g, PAPER.b)
  doc.setDrawColor(LINE.r, LINE.g, LINE.b)
  doc.roundedRect(margin, y, contentW, 14, 1.2, 1.2, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b)
  doc.text('ASESOR RESPONSABLE', margin + 4, y + 5)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(INK.r, INK.g, INK.b)
  doc.text(advisorName?.trim() || '—', margin + 4, y + 11)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text(advisorPhone?.trim() || 'Sin teléfono de asesor', pageW - margin - 4, y + 11, {
    align: 'right',
  })
  y += 20

  sectionTitle('Datos del solicitante')
  drawKvTable(leadRows)

  sectionTitle('Datos de la unidad')
  drawKvTable(unitSpecs)

  sectionTitle(isCash ? 'Resumen de compra' : 'Condiciones del crédito')
  drawKvTable(operationRows)

  // Highlight
  ensureSpace(36)
  doc.setFillColor(INK.r, INK.g, INK.b)
  doc.roundedRect(margin, y, contentW, 28, 2, 2, 'F')
  doc.setFillColor(GOLD.r, GOLD.g, GOLD.b)
  doc.rect(margin, y, contentW, 1.1, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b)
  doc.text(highlightLabel.toUpperCase(), margin + 5, y + 9)
  doc.setFontSize(20)
  doc.setTextColor(255, 255, 255)
  doc.text(highlightValue, margin + 5, y + 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(CREAM.r, CREAM.g, CREAM.b)
  doc.text(highlightHint, pageW - margin - 5, y + 20, { align: 'right' })
  y += 34

  // Condiciones
  sectionTitle('Condiciones y consideraciones')
  const conditions = isCash
    ? [
        '· Esta proforma es referencial y refleja una simulación de compra al contado.',
        '· El precio corresponde al valor comercial publicado al momento de la emisión.',
        '· La vigencia sugerida es de 15 días corridos desde la fecha de emisión.',
        '· No incluye gastos notariales, inscripción, impuestos ni costos de escritura salvo nota.',
        '· La reserva y firma de documentos se coordinan con el asesor responsable.',
        '· Este documento no constituye oferta vinculante ni contrato de compraventa.',
      ]
    : [
        '· Esta proforma es una simulación educativa/comercial del crédito propuesto.',
        '· La aprobación final depende de la institución financiera, avalúo y políticas vigentes.',
        '· La cuota mostrada usa amortización francesa sobre capital e intereses estimados.',
        '· No incluye seguros, gastos de otorgamiento ni cargos adicionales salvo indicación.',
        '· La vigencia sugerida es de 15 días corridos desde la fecha de emisión.',
        '· Este documento no constituye preaprobación ni oferta vinculante de crédito.',
      ]
  ensureSpace(8 + conditions.length * 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  for (const line of conditions) {
    const wrapped = doc.splitTextToSize(line, contentW)
    doc.text(wrapped, margin, y)
    y += wrapped.length * 4.2 + 1.2
  }
  y += 4

  if (row.notes?.trim()) {
    sectionTitle('Notas del asesor')
    const noteLines = doc.splitTextToSize(row.notes.trim(), contentW - 8)
    const notesH = Math.max(14, 7 + noteLines.length * 4.2)
    ensureSpace(notesH + 4)
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(LINE.r, LINE.g, LINE.b)
    doc.roundedRect(margin, y, contentW, notesH, 1.2, 1.2, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(INK.r, INK.g, INK.b)
    doc.text(noteLines, margin + 4, y + 6)
    y += notesH + 8
  }

  // Firmas
  ensureSpace(36)
  sectionTitle('Conformidad')
  const signW = (contentW - 8) / 2
  doc.setDrawColor(LINE.r, LINE.g, LINE.b)
  doc.setLineWidth(0.3)
  doc.line(margin + 4, y + 18, margin + signW - 4, y + 18)
  doc.line(margin + signW + 12, y + 18, pageW - margin - 4, y + 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text('Firma del solicitante', margin + 4, y + 23)
  doc.text('Firma del asesor', margin + signW + 12, y + 23)
  doc.setFontSize(7.5)
  doc.text(row.lead?.name || '________________', margin + 4, y + 28)
  doc.text(advisorName?.trim() || '________________', margin + signW + 12, y + 28)

  // Footer on last page
  doc.setDrawColor(LINE.r, LINE.g, LINE.b)
  doc.setLineWidth(0.3)
  doc.line(margin, pageH - 16, pageW - margin, pageH - 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b)
  doc.text(
    'La Vilet · Documento referencial. Conservar para seguimiento comercial.',
    margin,
    pageH - 10,
  )
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b)
  doc.text('www.lavilett.com', pageW - margin, pageH - 10, { align: 'right' })

  const unitPart = row.unit?.unit_number ? `_${safeName(row.unit.unit_number)}` : ''
  const leadPart = row.lead?.name ? `_${safeName(row.lead.name)}` : ''
  const filename = `proforma${unitPart}${leadPart || `_${row.id.slice(0, 8)}`}.pdf`
  doc.save(filename)
}
