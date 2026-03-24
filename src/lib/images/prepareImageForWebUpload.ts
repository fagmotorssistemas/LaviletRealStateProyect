import imageCompression from 'browser-image-compression'

/** Ancho/alto máximo en px (suficiente para web retina en héroes). */
const MAX_W_OR_H = 1920
/** Tamaño objetivo ~1 MB; el algoritmo reduce calidad/dimensiones para acercarse. */
const MAX_SIZE_MB = 1
const JPEG_QUALITY = 0.82

/**
 * Reduce peso y dimensiones de fotos antes de subirlas a Storage.
 * Salida habitual: JPEG ~82% calidad, máx. 1920px. GIFs se dejan igual (evita romper animaciones).
 */
export async function prepareImageForWebUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif') return file

  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: MAX_SIZE_MB,
      maxWidthOrHeight: MAX_W_OR_H,
      useWebWorker: true,
      fileType: 'image/jpeg',
      initialQuality: JPEG_QUALITY,
    })

    const base = file.name.replace(/\.[^/.]+$/, '') || 'foto'
    return new File([compressed], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}
