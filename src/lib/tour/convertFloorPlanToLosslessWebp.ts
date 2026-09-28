/**
 * Convierte cualquier imagen de plano de piso a WebP sin pérdida (máxima calidad).
 * Misma política que ambientes 360 (`convertUploadedSceneToWebp` mode lossless).
 */

const SHARP_OPTS = {
  limitInputPixels: 268_402_689,
  sequentialRead: true,
  failOn: 'none' as const,
}

export type FloorPlanLosslessWebp = {
  buffer: Buffer
  width: number
  height: number
  bytesIn: number
  bytesOut: number
}

export async function convertFloorPlanToLosslessWebp(
  sourceBuffer: Buffer,
): Promise<FloorPlanLosslessWebp> {
  const sharpMod = await import('sharp')
  const sharp = sharpMod.default
  if (typeof sharp !== 'function') {
    throw Object.assign(new Error('El conversor de imágenes no está disponible'), { status: 500 })
  }

  const rotated = sharp(sourceBuffer, SHARP_OPTS).rotate()
  const meta = await rotated.metadata()
  const buffer = await sharp(sourceBuffer, SHARP_OPTS)
    .rotate()
    .webp({ lossless: true, effort: 4 })
    .toBuffer()

  const width = meta.width || 1
  const height = meta.height || 1
  if (width <= 1 || height <= 1) {
    throw Object.assign(new Error('No se pudieron leer las dimensiones de la imagen'), {
      status: 400,
    })
  }

  return {
    buffer,
    width,
    height,
    bytesIn: sourceBuffer.byteLength,
    bytesOut: buffer.byteLength,
  }
}
