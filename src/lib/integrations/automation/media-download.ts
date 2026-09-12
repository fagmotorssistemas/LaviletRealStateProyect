import { text } from './data'

// Kommo's attachment service redirects to its drive and then a signed storage URL.
// Storage is accepted only as a redirect from that drive, never as an inbound URL.
export async function downloadMedia(source: string) {
  const allowed = new Set(['amojo.kommo.com', 'drive-g.kommo.com', ...(process.env.KOMMO_MEDIA_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)])
  let url = new URL(source), previous = ''
  const signal = AbortSignal.timeout(20_000)
  for (let hop = 0; hop <= 3; hop++) {
    const storage = previous === 'drive-g.kommo.com' && url.hostname === 'storage.googleapis.com'
    if (url.protocol !== 'https:' || url.username || url.password || url.port || (!allowed.has(url.hostname) && !storage)) throw Error('MEDIA_HOST_NOT_ALLOWED')
    const response = await fetch(url, { redirect: 'manual', signal })
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel()
      if (!location || hop === 3) throw Error('MEDIA_REDIRECT_LIMIT')
      previous = url.hostname; url = new URL(location, url); continue
    }
    if (!response.ok) throw Error('MEDIA_DOWNLOAD_FAILED')
    const limit = 20 * 1024 * 1024
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error('MEDIA_TOO_LARGE') }
    const reader = response.body?.getReader(); if (!reader) throw Error('EMPTY_MEDIA')
    const chunks: Uint8Array[] = []; let size = 0
    try {
      while (true) { const {value,done} = await reader.read(); if (done) break
        size += value.byteLength; if (size > limit) { await reader.cancel(); throw Error('MEDIA_TOO_LARGE') } chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = Buffer.concat(chunks), declared = text(response.headers.get('content-type')).split(';')[0].toLowerCase()
    // A drive can send application/octet-stream. Recognize only known magic bytes.
    const mime = bytes.subarray(0,5).toString() === '%PDF-' ? 'application/pdf'
      : bytes.subarray(0,3).equals(Buffer.from([255,216,255])) ? 'image/jpeg'
      : bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
      : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp'
      : declared
    return {bytes,mime}
  }
  throw Error('MEDIA_REDIRECT_LIMIT')
}
