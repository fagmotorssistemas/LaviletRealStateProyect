/**
 * Foto de amenidad para la galería a pantalla completa.
 * El largo máximo es 2560 px y el WebP va a calidad alta: se ve nítida y carga de inmediato.
 * Los planos siguen en WebP sin pérdida; esto es solo para fotografías.
 */

const SHARP_OPTS = {
  limitInputPixels: 268_402_689,
  sequentialRead: true,
  failOn: 'none' as const,
}

const MAX_EDGE = 2560
const QUALITY = 88

export type AmenityPhotoWebp = {
  buffer: Buffer
  width: number
  height: number
  bytesIn: number
  bytesOut: number
}

export async function convertAmenityPhotoToWebp(sourceBuffer: Buffer): Promise<AmenityPhotoWebp> {
  const sharpMod = await import('sharp')
  const sharp = sharpMod.default
  if (typeof sharp !== 'function') {
    throw Object.assign(new Error('El conversor de imágenes no está disponible'), { status: 500 })
  }

  const bytesIn = sourceBuffer.byteLength
  const { data: buffer, info } = await sharp(sourceBuffer, SHARP_OPTS)
    .rotate()
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: QUALITY, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true })
  const width = info.width || 1
  const height = info.height || 1
  if (width <= 1 || height <= 1) {
    throw Object.assign(new Error('No se pudieron leer las dimensiones de la imagen'), { status: 400 })
  }
  return { buffer, width, height, bytesIn, bytesOut: buffer.byteLength }
}
