import type { Inbound } from './webhook'

export const audioExtensions: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/flac': 'flac',
}

type TranscriptRow = Record<string, unknown>
const transcriptRow = (value: unknown): TranscriptRow => value && typeof value === 'object' && !Array.isArray(value) ? value as TranscriptRow : {}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// Transcription is evidence for appointments and consent. Reject the entire
// recording if any spoken segment is uncertain: dropping a doubtful "no", date
// or amount would change the customer's intent. These conservative confidence
// thresholds are application policy, not a guarantee from the provider.
export function clearAudioTranscript(value: unknown, model: string) {
  const result = transcriptRow(value)
  const transcript = typeof result.text === 'string' ? result.text.trim() : ''
  if (!transcript || transcript.length > 20_000 || !/[\p{L}\p{N}]/u.test(transcript)) throw Error('INVALID_TRANSCRIPTION')
  if (model === 'whisper-1') {
    const segments = Array.isArray(result.segments) ? result.segments.map(transcriptRow).filter(s => typeof s.text === 'string' && s.text.trim()) : []
    if (!segments.length || !finite(result.duration) || result.duration <= 0) throw Error('TRANSCRIPTION_QUALITY_MISSING')
    for (const segment of segments) {
      if (!finite(segment.no_speech_prob) || !finite(segment.avg_logprob) || !finite(segment.compression_ratio)
        || segment.no_speech_prob < 0 || segment.no_speech_prob > 1 || segment.avg_logprob > 0 || segment.compression_ratio < 0) throw Error('TRANSCRIPTION_QUALITY_MISSING')
      if (segment.no_speech_prob >= 0.5) throw Error('AUDIO_NO_CLEAR_SPEECH')
      if (segment.avg_logprob < -1 || segment.compression_ratio > 2.4) throw Error('AUDIO_UNINTELLIGIBLE')
    }
    return segments.map(s => (s.text as string).trim()).join(' ')
  }
  const tokens = Array.isArray(result.logprobs) ? result.logprobs.map(transcriptRow).filter(t => typeof t.token === 'string' && /[\p{L}\p{N}]/u.test(t.token)) : []
  if (!tokens.length || tokens.some(t => !finite(t.logprob) || t.logprob > 0)) throw Error('TRANSCRIPTION_QUALITY_MISSING')
  const confidence = tokens.map(t => t.logprob as number)
  if (confidence.reduce((sum, n) => sum + n, 0) / confidence.length < -0.65 || Math.min(...confidence) < -2.5) throw Error('AUDIO_UNINTELLIGIBLE')
  return transcript
}

// A small PCM check catches digital silence before asking a model to transcribe
// it. Compressed audio still uses the provider's speech/confidence metadata.
export function wavHasSignal(bytes: Buffer): boolean | null {
  if (bytes.length < 12 || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') return null
  let format = 0, bits = 0, signal: Buffer | null = null
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size
    if (end > bytes.length) return null
    const kind = bytes.subarray(offset, offset + 4).toString()
    if (kind === 'fmt ' && size >= 16) { format = bytes.readUInt16LE(offset + 8); bits = bytes.readUInt16LE(offset + 22) }
    if (kind === 'data') signal = bytes.subarray(offset + 8, end)
    offset = end + (size % 2)
  }
  if (!signal || ![1, 3].includes(format) || (format === 1 && ![8, 16, 24, 32].includes(bits)) || (format === 3 && bits !== 32)) return null
  const width = bits / 8
  for (let i = 0; i + width <= signal.length; i += width) {
    const sample = format === 3 ? signal.readFloatLE(i) : bits === 8 ? (signal[i] - 128) / 128 : signal.readIntLE(i, width) / 2 ** (bits - 1)
    if (Number.isFinite(sample) && Math.abs(sample) > 0.00001) return true
  }
  return false
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
    : 'Disculpe, no alcancé a entender este audio con claridad. ¿Puede enviarlo de nuevo o escribirme lo que necesita?'
  return 'No alcancé a leer este archivo. ¿Puede enviarlo más nítido o escribir el número de la unidad?'
}
