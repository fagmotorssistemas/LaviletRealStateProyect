export type AmenityGalleryItem = {
  title: string
  titleEn: string
  imageUrl: string
}

const CAPTION_ORDER = ['Exterior', 'Planta baja', 'Planta alta', 'Piscina', 'Jacuzzi', 'Gimnasio']

/**
 * Nombres sueltos, sin leer la carpeta en runtime.
 * Un readdir de public/tour/amenidades mete los PNG en la función de Vercel y supera 250 MB.
 */
const AMENITY_FILES = [
  'Exterior 1 con personas.png',
  'Exterior 2 con personas.png',
  'Exterior 3 con personas.png',
  'Gym 1 con persona.png',
  'Gym 2 con persona.png',
  'Gym 3 con persona.png',
  'GYM 4 con persona.png',
  'Jacuzzi 1 con persona.png',
  'Jacuzzi 2 con persona.png',
  'PA_exterior 1.png',
  'PA_exterior 2.png',
  'PA_exterior 3.png',
  'PB_exterior 1.png',
  'PB_exterior 2.png',
  'piscina 2.png',
  'piscina personas.png',
  'piscina.png',
  'pl6-final.png',
] as const

/** Título visible a partir del nombre del archivo, sin notas de producción. */
export function amenityCaptionFromFile(file: string): { title: string; titleEn: string } {
  const base = file
    .replace(/\.[^.]+$/, '')
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

export function listAmenityGallery(): AmenityGalleryItem[] {
  return AMENITY_FILES.filter((file) => !/\bsin\s+personas?\b/i.test(file))
    .map((file) => {
      const caption = amenityCaptionFromFile(file)
      return {
        title: caption.title,
        titleEn: caption.titleEn,
        imageUrl: `/tour/amenidades/${encodeURIComponent(file)}`,
        file,
      }
    })
    .sort((a, b) => {
      const rankA = CAPTION_ORDER.indexOf(a.title)
      const rankB = CAPTION_ORDER.indexOf(b.title)
      const orderA = rankA === -1 ? CAPTION_ORDER.length : rankA
      const orderB = rankB === -1 ? CAPTION_ORDER.length : rankB
      if (orderA !== orderB) return orderA - orderB
      return a.file.localeCompare(b.file, 'es', { numeric: true })
    })
    .map(({ title, titleEn, imageUrl }) => ({ title, titleEn, imageUrl }))
}
