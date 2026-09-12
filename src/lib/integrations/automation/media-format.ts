import type { Inbound } from './webhook'

export const audioExtensions: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/flac': 'flac',
}

// Trust file signatures before a generic or misleading download header. Do not
// guess format from a user-controlled filename, and do not treat video as audio.
export function mediaMime(bytes: Buffer, header: string) {
  const start = (n: number) => bytes.subarray(0, n).toString('ascii')
  if (start(5) === '%PDF-') return 'application/pdf'
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  if (start(4) === 'RIFF') {
    if (bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
    if (bytes.subarray(8, 12).toString() === 'WAVE') return 'audio/wav'
  }
  if (start(4) === 'OggS' && (bytes.includes(Buffer.from('OpusHead')) || bytes.includes(Buffer.from('vorbis')))) return 'audio/ogg'
  if (start(4) === 'fLaC') return 'audio/flac'
  if (start(3) === 'ID3' || (bytes.length > 2 && bytes[0] === 255 && (bytes[1] & 0xe6) === 0xe2)) return 'audio/mpeg'
  if (bytes.subarray(4, 8).toString() === 'ftyp' && /^M4A |M4B /.test(bytes.subarray(8,12).toString())) return 'audio/mp4'
  const declared = header.split(';')[0].trim().toLowerCase()
  const aliases: Record<string, string> = { 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-m4a': 'audio/mp4', 'audio/mp3': 'audio/mpeg', 'application/ogg': 'audio/ogg', 'audio/x-flac': 'audio/flac' }
  return aliases[declared] || declared
}

export function isAudioMedia(media: Inbound['media']) {
  return !!media && (/audio|voice|ptt/i.test(media.type) || /\.(?:ogg|opus|mp3|m4a|wav|webm|flac)(?:$|\?)/i.test(media.name || media.url))
}
export function unreadMediaMarker(media: Inbound['media']) {
  return `[Archivo no interpretado: ${isAudioMedia(media) ? 'nota de voz no transcrita' : 'adjunto no leído'}; responda el texto escrito y pida reenviar solo lo que falta. El canal admite audio, imágenes y texto]`
}
export function mediaFailureReply(media: Inbound['media'], errors: string[]) {
  if (isAudioMedia(media)) return errors.includes('MEDIA_TOO_LARGE')
    ? 'El audio supera el tamaño que puedo procesar. ¿Puede enviarlo dividido en notas de voz más cortas?'
    : 'No alcancé a entender este audio. ¿Puede reenviarlo o escribirme lo que necesita?'
  return 'No alcancé a leer este archivo. ¿Puede enviarlo más nítido o escribir el número de la unidad?'
}
