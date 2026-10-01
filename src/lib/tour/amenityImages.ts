export type AmenityGalleryItem = {
  title: string
  titleEn: string
  imageUrl: string
  name: string
}

const CAPTION_ORDER = ['Exterior', 'Planta baja', 'Planta alta', 'Piscina', 'Jacuzzi', 'Gimnasio']

/** Título visible a partir del nombre del archivo, sin notas de producción. */
export function amenityCaptionFromFile(file: string): { title: string; titleEn: string } {
  const base = file
    .replace(/\.[^.]+$/, '')
    .replace(/-r\d+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(con|sin)\s+personas?\b/gi, ' ')
    .replace(/\bfinal\b/gi, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (base === 'pl' || base.startsWith('pl ')) return { title: 'Planta baja', titleEn: 'Ground floor' }
  if (base === 'pb' || base.startsWith('pb ')) return { title: 'Planta baja', titleEn: 'Ground floor' }
  if (base === 'pa' || base.startsWith('pa ')) return { title: 'Planta alta', titleEn: 'Upper floor' }
  if (base.includes('gym')) return { title: 'Gimnasio', titleEn: 'Gym' }
  if (base.includes('piscina')) return { title: 'Piscina', titleEn: 'Pool' }
  if (base.includes('jacuzzi')) return { title: 'Jacuzzi', titleEn: 'Jacuzzi' }
  if (base.includes('exterior')) return { title: 'Exterior', titleEn: 'Exterior' }

  const title = base.replace(/\b\w/g, (letter) => letter.toUpperCase())
  return { title, titleEn: title }
}

export function sortAmenityItems<T extends { title: string; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankA = CAPTION_ORDER.indexOf(a.title)
    const rankB = CAPTION_ORDER.indexOf(b.title)
    const orderA = rankA === -1 ? CAPTION_ORDER.length : rankA
    const orderB = rankB === -1 ? CAPTION_ORDER.length : rankB
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name, 'es', { numeric: true })
  })
}
