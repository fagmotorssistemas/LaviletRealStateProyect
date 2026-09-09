/**
 * PDF de ficha técnica del showroom (estilo ficha comercial · La Vilet).
 * Importar solo desde cliente (`import()`).
 *
 * Usa Noto Sans embebida: Helvetica de jsPDF no trae glifos latinos y las
 * letras con tildes/ñ/m² quedan apiladas en la misma posición.
 */
import type { jsPDF } from 'jspdf'
import type { TourUnitSummary } from '@/types/tour'
import { UNIT_STATUS_OPTIONS, type UnitStatus } from '@/types/inmobiliaria'
import { buildFichaSpecRows } from '@/lib/tour/fichaSpecs'

export type FichaPdfImage = {
  label: string
  url: string
}

const FONT_FAMILY = 'NotoSans'

type PdfFonts = { regular: string; bold: string }

let fontsCache: PdfFonts | null = null
let fontsPromise: Promise<PdfFonts> | null = null

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function loadPdfFonts(): Promise<PdfFonts> {
  if (fontsCache) return fontsCache
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const [regularBuf, boldBuf] = await Promise.all([
        fetch('/fonts/NotoSans-Regular.ttf').then((res) => {
          if (!res.ok) throw new Error('No se pudo cargar NotoSans-Regular')
          return res.arrayBuffer()
        }),
        fetch('/fonts/NotoSans-Bold.ttf').then((res) => {
          if (!res.ok) throw new Error('No se pudo cargar NotoSans-Bold')
          return res.arrayBuffer()
        }),
      ])
      fontsCache = {
        regular: arrayBufferToBase64(regularBuf),
        bold: arrayBufferToBase64(boldBuf),
      }
      return fontsCache
    })().catch((error) => {
      fontsPromise = null
      throw error
    })
  }
  return fontsPromise
}

function registerPdfFonts(doc: jsPDF, fonts: PdfFonts) {
  const tagged = doc as jsPDF & { __laviletFonts?: boolean }
  if (!tagged.__laviletFonts) {
    doc.addFileToVFS('NotoSans-Regular.ttf', fonts.regular)
    doc.addFont('NotoSans-Regular.ttf', FONT_FAMILY, 'normal')
    doc.addFileToVFS('NotoSans-Bold.ttf', fonts.bold)
    doc.addFont('NotoSans-Bold.ttf', FONT_FAMILY, 'bold')
    tagged.__laviletFonts = true
  }
  doc.setFont(FONT_FAMILY, 'normal')
  doc.setCharSpace(0)
}

function setPdfFont(doc: jsPDF, style: 'normal' | 'bold', size?: number) {
  if (size != null) doc.setFontSize(size)
  doc.setFont(FONT_FAMILY, style)
  doc.setCharSpace(0)
}

async function blobToJpegDataUrl(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', 0.88)
  } catch {
    return null
  }
}

async function toDataUrl(url: string): Promise<{ data: string; format: 'JPEG' | 'PNG' } | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    const mime = blob.type || 'image/jpeg'
    // jsPDF suele fallar con WEBP; normalizamos a JPEG.
    if (mime.includes('webp') || mime.includes('gif') || mime.includes('avif')) {
      const jpeg = await blobToJpegDataUrl(blob)
      return jpeg ? { data: jpeg, format: 'JPEG' } : null
    }
    if (mime.includes('png')) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('read failed'))
        reader.readAsDataURL(blob)
      })
      return { data, format: 'PNG' }
    }
    const jpeg =
      mime.includes('jpeg') || mime.includes('jpg')
        ? await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(new Error('read failed'))
            reader.readAsDataURL(blob)
          })
        : await blobToJpegDataUrl(blob)
    return jpeg ? { data: jpeg, format: 'JPEG' } : null
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

  const fonts = await loadPdfFonts()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  registerPdfFonts(doc, fonts)

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
  setPdfFont(doc, 'normal', 8)
  doc.text('FICHA TÉCNICA', margin, 12)
  doc.setTextColor(247, 243, 238)
  setPdfFont(doc, 'bold', 18)
  doc.text(projectName, margin, 23)

  setPdfFont(doc, 'normal', 9)
  doc.setTextColor(189, 162, 126)
  const rightMeta = `${typologyCode}${typologyName ? ` · ${typologyName}` : ''}`
  doc.text(rightMeta, pageW - margin, 14, { align: 'right' })
  doc.setTextColor(247, 243, 238)
  setPdfFont(doc, 'bold', 11)
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
  setPdfFont(doc, 'bold', 20)
  const unitTitle = `Unidad ${unit.unit_number}`
  doc.text(unitTitle, margin, y)
  const unitTitleW = doc.getTextWidth(unitTitle)

  const status = statusLabel(unit.status)
  setPdfFont(doc, 'bold', 8)
  const statusW = doc.getTextWidth(status) + 6
  doc.setFillColor(61, 155, 74)
  if (unit.status === 'reservado' || unit.status === 'en_proceso' || unit.status === 'bajo_contrato') {
    doc.setFillColor(232, 165, 75)
  } else if (unit.status === 'vendido' || unit.status === 'deshabilitado') {
    doc.setFillColor(214, 69, 69)
  } else if (unit.status !== 'disponible' && unit.status !== 'en_preventa') {
    doc.setFillColor(156, 163, 175)
  }
  doc.roundedRect(margin + unitTitleW + 4, y - 5, statusW, 6, 1.5, 1.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text(status, margin + unitTitleW + 7, y - 1)

  y += 9
  doc.setTextColor(43, 26, 24)
  setPdfFont(doc, 'bold', 18)
  doc.text(formatPrice(unit.published_commercial_price), margin, y)
  y += 10

  // Specs — Superficies / tipología
  const specs = buildFichaSpecRows(unit)
  setPdfFont(doc, 'bold', 9)
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
    setPdfFont(doc, 'normal', 8)
    doc.setTextColor(120, 110, 100)
    doc.text(label.toUpperCase(), margin + 4, rowY)
    setPdfFont(doc, 'bold', 9)
    doc.setTextColor(43, 26, 24)
    doc.text(value, margin + contentW - 4, rowY, { align: 'right' })
    rowY += 8
  }
  y += cardH + 8

  if (unit.spaces && unit.spaces.length > 0) {
    setPdfFont(doc, 'bold', 8)
    doc.setTextColor(189, 162, 126)
    doc.text('ESPACIOS', margin, y)
    y += 5
    setPdfFont(doc, 'normal', 9)
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
      registerPdfFonts(doc, fonts)
      y = 18
    }
    setPdfFont(doc, 'bold', 8)
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
        registerPdfFonts(doc, fonts)
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
      setPdfFont(doc, 'normal', 6)
      doc.setTextColor(100, 90, 80)
      doc.text(gallery[i].label.slice(0, 28), x + 1.5, rowTop + cellH - 1.5)
      col = (col + 1) % cols
    }
  }

  // Footer on all pages
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    registerPdfFonts(doc, fonts)
    doc.setDrawColor(189, 162, 126)
    doc.setLineWidth(0.35)
    doc.line(margin, pageH - 10, pageW - margin, pageH - 10)
    setPdfFont(doc, 'normal', 7)
    doc.setTextColor(140, 130, 120)
    doc.text(`${projectName} · ${typologyCode} · Unidad ${unit.unit_number}`, margin, pageH - 5)
    doc.text(`${p} / ${pageCount}`, pageW - margin, pageH - 5, { align: 'right' })
  }

  const safeCode = unit.unit_number.replace(/[^\w.-]+/g, '_')
  doc.save(`ficha-${typologyCode}-${safeCode}.pdf`)
}
