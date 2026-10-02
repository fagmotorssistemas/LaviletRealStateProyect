/**
 * Archivos con versión, revisión o timestamp en el nombre pueden cachearse un año:
 * la URL cambia cuando cambia el archivo.
 * El JSON que se reescribe siempre en la misma ruta queda en 60 segundos.
 */
export function storageCacheControl(fileName: string, options?: { json?: boolean }): '60' | '31536000' {
  if (options?.json || /\.json$/i.test(fileName)) return '60'
  if (
    /-r\d{6,}/i.test(fileName) ||
    /-v\d{6,}/i.test(fileName) ||
    /_v\d{6,}/i.test(fileName) ||
    /(?:^|\/)\d{10,}-/.test(fileName)
  ) {
    return '31536000'
  }
  return '31536000'
}
