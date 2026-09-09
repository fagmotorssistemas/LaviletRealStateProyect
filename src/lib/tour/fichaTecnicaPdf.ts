/**
 * PDF de ficha técnica del showroom (estilo ficha comercial · La Vilet).
 * Importar solo desde cliente (`import()`).
 */
import type { TourUnitSummary } from '@/types/tour'
import { UNIT_STATUS_OPTIONS, type UnitStatus } from '@/types/inmobiliaria'
import { buildFichaSpecRows } from '@/lib/tour/fichaSpecs'

export type FichaPdfImage = {
  label: string
  url: string
}

function statusLabel(status: UnitStatus) {
  return UNIT_STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status
}

function formatPrice(value: number | null) {
  if (value == null) return 'Consultar'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

async function toDataUrl(url: string): Promise<{ data: string; format: 'JPEG' | 'PNG' | 'WEBP' } | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    const mime = blob.type || 'image/jpeg'
    const format: 'JPEG' | 'PNG' | 'WEBP' =
      mime.includes('png') ? 'PNG' : mime.includes('webp') ? 'WEBP' : 'JPEG'
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('read failed'))
      reader.readAsDataURL(blob)
    })
    return { data, format }
  } catch {
    return null
  }
}

export async function downloadFichaTecnicaPdf(params: {
  typologyCode: string
  typologyName?: string
  unit: TourUnitSummary
  images?: FichaPdfImage[]
  projectName?: string
}) {
  const { jsPDF } = await import('jspdf')
  const {
    typologyCode,
    typologyName,
    unit,
    images = [],
    projectName = 'La Vilet',
  } = params

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentW = pageW - margin * 2

  // Brand bar (warm La Vilet)
  doc.setFillColor(43, 26, 24)
  doc.rect(0, 0, pageW, 32, 'F')
  doc.setFillColor(189, 162, 126)
  doc.rect(0, 32, pageW, 1.2, 'F')

  doc.setTextColor(189, 162, 126)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('FICHA TÉCNICA', margin, 12)
  doc.setTextColor(247, 243, 238)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(projectName, margin, 23)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(189, 162, 126)
  const rightMeta = `${typologyCode}${typologyName ? ` · ${typologyName}` : ''}`
  doc.text(rightMeta, pageW - margin, 14, { align: 'right' })
  doc.setTextColor(247, 243, 238)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(`Unidad ${unit.unit_number}`, pageW - margin, 23, { align: 'right' })

  let y = 42

  // Hero image
  const hero = images[0]
  const heroH = 72
  if (hero) {
    const loaded = await toDataUrl(hero.url)
    doc.setFillColor(238, 234, 228)
    doc.roundedRect(margin, y, contentW, heroH, 2, 2, 'F')
    if (loaded) {
      try {
        doc.addImage(
          loaded.data,
          loaded.format,
          margin + 1,
          y + 1,
          contentW - 2,
          heroH - 2,
          undefined,
          'FAST',
        )
      } catch {
        // skip
      }
    }
    y += heroH + 8
  }

  // Title + status + price
  doc.setTextColor(43, 26, 24)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text(`Unidad ${unit.unit_number}`, margin, y)

  const status = statusLabel(unit.status)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  const statusW = doc.getTextWidth(status) + 6
  doc.setFillColor(61, 155, 74)
  if (unit.status === 'reservado' || unit.status === 'en_proceso' || unit.status === 'bajo_contrato') {
    doc.setFillColor(232, 165, 75)
  } else if (unit.status === 'vendido' || unit.status === 'deshabilitado') {
    doc.setFillColor(214, 69, 69)
  } else if (unit.status !== 'disponible' && unit.status !== 'en_preventa') {
    doc.setFillColor(156, 163, 175)
  }
  doc.roundedRect(margin + doc.getTextWidth(`Unidad ${unit.unit_number}`) + 4, y - 5, statusW, 6, 1.5, 1.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text(status, margin + doc.getTextWidth(`Unidad ${unit.unit_number}`) + 7, y - 1)

  y += 9
  doc.setTextColor(43, 26, 24)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(formatPrice(unit.published_commercial_price), margin, y)
  y += 10

  // Specs — Superficies / tipología
  const specs = buildFichaSpecRows(unit)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(189, 162, 126)
  doc.text('ESPECIFICACIONES', margin, y)
  y += 4

  doc.setDrawColor(43, 26, 24)
  doc.setLineWidth(0.15)
  doc.setFillColor(252, 250, 247)
  const cardH = 6 + specs.length * 8
  doc.roundedRect(margin, y, contentW, cardH, 2, 2, 'FD')

  let rowY = y + 7
  for (const { label, value } of specs) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(120, 110, 100)
    doc.text(label.toUpperCase(), margin + 4, rowY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(43, 26, 24)
    doc.text(value, margin + contentW - 4, rowY, { align: 'right' })
    rowY += 8
  }
  y += cardH + 8

  if (unit.spaces && unit.spaces.length > 0) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(189, 162, 126)
    doc.text('ESPACIOS', margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(43, 26, 24)
    const spaceLine = doc.splitTextToSize(unit.spaces.join(' · '), contentW)
    doc.text(spaceLine, margin, y)
    y += spaceLine.length * 4.5 + 6
  }

  // Gallery grid (resto de imágenes)
  const gallery = images.slice(hero ? 1 : 0, 9)
  if (gallery.length > 0) {
    if (y > pageH - 70) {
      doc.addPage()
      y = 18
    }
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(189, 162, 126)
    doc.text('GALERÍA', margin, y)
    y += 4

    const gap = 3
    const cols = 3
    const cellW = (contentW - gap * (cols - 1)) / cols
    const cellH = 38
    let col = 0
    let rowTop = y

    for (let i = 0; i < gallery.length; i++) {
      if (col === 0 && i > 0) rowTop += cellH + gap + 4
      if (rowTop + cellH > pageH - 18) {
        doc.addPage()
        rowTop = 18
        col = 0
      }
      const x = margin + col * (cellW + gap)
      const loaded = await toDataUrl(gallery[i].url)
      doc.setFillColor(238, 234, 228)
      doc.roundedRect(x, rowTop, cellW, cellH, 1.2, 1.2, 'F')
      if (loaded) {
        try {
          doc.addImage(
            loaded.data,
            loaded.format,
            x + 1,
            rowTop + 1,
            cellW - 2,
            cellH - 7,
            undefined,
            'FAST',
          )
        } catch {
          // skip
        }
      }
      doc.setFontSize(6)
      doc.setTextColor(100, 90, 80)
      doc.text(gallery[i].label.slice(0, 28), x + 1.5, rowTop + cellH - 1.5)
      col = (col + 1) % cols
    }
  }

  // Footer on all pages
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setDrawColor(189, 162, 126)
    doc.setLineWidth(0.35)
    doc.line(margin, pageH - 10, pageW - margin, pageH - 10)
    doc.setFontSize(7)
    doc.setTextColor(140, 130, 120)
    doc.text(`${projectName} · ${typologyCode} · Unidad ${unit.unit_number}`, margin, pageH - 5)
    doc.text(`${p} / ${pageCount}`, pageW - margin, pageH - 5, { align: 'right' })
  }

  const safeCode = unit.unit_number.replace(/[^\w.-]+/g, '_')
  doc.save(`ficha-${typologyCode}-${safeCode}.pdf`)
}
