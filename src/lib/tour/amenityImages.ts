import { readdir } from 'node:fs/promises'
import path from 'node:path'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'])

export type AmenityGalleryItem = {
  title: string
  titleEn: string
  imageUrl: string
}

const CAPTION_ORDER = ['Exterior', 'Planta baja', 'Planta alta', 'Piscina', 'Jacuzzi', 'Gimnasio']

/** Título visible a partir del nombre del archivo, sin notas de producción. */
export function amenityCaptionFromFile(file: string): { title: string; titleEn: string } {
  const base = path
    .basename(file, path.extname(file))
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

export async function listAmenityGallery(): Promise<AmenityGalleryItem[]> {
  const dir = path.join(process.cwd(), 'public', 'tour', 'amenidades')
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  return files
    .filter((file) => IMAGE_EXT.has(path.extname(file).toLowerCase()))
    .filter((file) => !/\bsin\s+personas?\b/i.test(file))
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
