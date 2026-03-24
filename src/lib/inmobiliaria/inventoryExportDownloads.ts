/**
 * Descargas Excel/PDF. Solo importar vía `import()` desde el cliente para evitar
 * que el bundler SSR resuelva entradas Node (jspdf/fflate).
 */

export async function downloadInventoryExcel(headers: string[], rows: string[][], filename: string) {
  const XLSX = await import('xlsx')
  const aoa = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

export async function downloadInventoryPdf(params: {
  title: string
  subtitle?: string
  headers: string[]
  rows: string[][]
  filename: string
}) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableMod.default
  const { title, subtitle, headers, rows, filename } = params
  const landscape = headers.length > 8
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  doc.setFontSize(14)
  doc.setTextColor(43, 26, 24)
  doc.text(title, 14, 16)
  if (subtitle) {
    doc.setFontSize(9)
    doc.setTextColor(80, 80, 80)
    const lines = doc.splitTextToSize(subtitle, landscape ? 270 : 180)
    doc.text(lines, 14, 22)
  }
  const startY = subtitle ? 28 : 22
  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    styles: { fontSize: landscape ? 7 : 8, cellPadding: 2 },
    headStyles: { fillColor: [43, 26, 24], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: 14, right: 14 },
    tableWidth: 'auto',
  })
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}
