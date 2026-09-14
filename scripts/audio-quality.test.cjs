const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename)
const { clearAudioTranscript, wavHasSignal, mediaFailureReply } = require('../src/lib/integrations/automation/media-format.ts')
const whisper = (text, overrides = {}) => ({ text, duration: 7.4,
  segments: [{ text, no_speech_prob: 0.01, avg_logprob: -0.1, compression_ratio: 1, ...overrides }] })

test('the reported silent recording is rejected despite its plausible Whisper text', () => {
  assert.throws(() => clearAudioTranscript(whisper('Subtítulos realizados por la comunidad de Amara.org', {
    no_speech_prob: 0.5601456761360168, avg_logprob: -0.31554529070854187, compression_ratio: 0.8813559412956238,
  }), 'whisper-1'), /AUDIO_NO_CLEAR_SPEECH/)
})

test('silence cannot become an affirmation, appointment, financing consent or greeting', () => {
  for (const text of ['Sí.', 'Claro, con gusto.', 'Mañana a las ocho.', 'Autorizo la revisión.', 'Hola.']) {
    assert.throws(() => clearAudioTranscript(whisper(text, { no_speech_prob: 0.82 }), 'whisper-1'), /AUDIO_NO_CLEAR_SPEECH/)
  }
})

test('clear short audio is allowed without a phrase blacklist or minimum word count', () => {
  for (const text of ['Sí.', 'No.', 'Gracias.', 'A las ocho.', 'No se entiende.']) {
    assert.equal(clearAudioTranscript(whisper(text), 'whisper-1'), text)
  }
})

test('missing or malformed quality data fails closed', () => {
  for (const value of [{ text: 'Sí.' }, { text: 'Sí.', segments: [], duration: 3 }, whisper('Sí.', { no_speech_prob: null }), whisper('Sí.', { avg_logprob: NaN })]) {
    assert.throws(() => clearAudioTranscript(value, 'whisper-1'), /TRANSCRIPTION_QUALITY_MISSING/)
  }
})

test('uncertain words do not get dropped to manufacture a confident partial transcript', () => {
  const result = whisper('Quiero la cita. No, mañana no puedo.')
  result.segments = [whisper('Quiero la cita.').segments[0], whisper('No, mañana no puedo.', { avg_logprob: -1.3 }).segments[0]]
  assert.throws(() => clearAudioTranscript(result, 'whisper-1'), /AUDIO_UNINTELLIGIBLE/)
})

test('repetitive or absent transcripts do not enter the conversation', () => {
  assert.throws(() => clearAudioTranscript(whisper('Gracias. '.repeat(20), { compression_ratio: 3.2 }), 'whisper-1'), /AUDIO_UNINTELLIGIBLE/)
  for (const text of ['', '   ', '...']) assert.throws(() => clearAudioTranscript(whisper(text), 'whisper-1'), /INVALID_TRANSCRIPTION/)
})

test('the same silent recording is rejected by GPT transcription confidence', () => {
  assert.throws(() => clearAudioTranscript({ text: 'بسم الله.', logprobs: [
    { token: 'ب', logprob: -4.6251068115234375 }, { token: 'سم', logprob: -1.7781347036361694 }, { token: ' الله', logprob: -0.2897919714450836 },
  ] }, 'gpt-4o-transcribe'), /AUDIO_UNINTELLIGIBLE/)
})

test('clear GPT transcription is accepted and missing token confidence is rejected', () => {
  assert.equal(clearAudioTranscript({ text: 'Mañana a las ocho.', logprobs: [
    { token: 'Mañana', logprob: -0.02 }, { token: ' a', logprob: -0.01 }, { token: ' las', logprob: -0.01 }, { token: ' ocho', logprob: -0.06 },
  ] }, 'gpt-4o-mini-transcribe'), 'Mañana a las ocho.')
  assert.throws(() => clearAudioTranscript({ text: 'Sí.' }, 'gpt-4o-transcribe'), /TRANSCRIPTION_QUALITY_MISSING/)
})

function wav(bits = 16, format = 1) {
  const bytes = Buffer.alloc(44 + 16000 * bits / 8)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(format, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24)
  bytes.writeUInt32LE(16000 * bits / 8, 28); bytes.writeUInt16LE(bits / 8, 32); bytes.writeUInt16LE(bits, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
  if (bits === 8) bytes.fill(128, 44)
  return bytes
}

test('PCM silence is detected across normal WAV sample encodings', () => {
  for (const [bits, format] of [[8, 1], [16, 1], [24, 1], [32, 1], [32, 3]]) assert.equal(wavHasSignal(wav(bits, format)), false)
  const bytes = wav(); bytes.writeInt16LE(5000, 46); assert.equal(wavHasSignal(bytes), true)
  assert.equal(wavHasSignal(Buffer.from('OggScompressed')), null)
})

function mediaModule(bytes, mime) {
  const filename = path.join(root, 'src/lib/integrations/automation/ai.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const m = { exports: {} }, localRequire = Module.createRequire(filename)
  new Function('require', 'module', 'exports', source)(id => id === './media-download' ? { downloadMedia: async () => ({ bytes, mime }) } : localRequire(id), m, m.exports)
  return m.exports
}
function api(t, model, handler) {
  const fetch = global.fetch, key = process.env.OPENAI_API_KEY, previousModel = process.env.OPENAI_TRANSCRIPTION_MODEL
  process.env.OPENAI_API_KEY = 'synthetic'; process.env.OPENAI_TRANSCRIPTION_MODEL = model; global.fetch = handler
  t.after(() => { global.fetch = fetch
    key === undefined ? delete process.env.OPENAI_API_KEY : process.env.OPENAI_API_KEY = key
    previousModel === undefined ? delete process.env.OPENAI_TRANSCRIPTION_MODEL : process.env.OPENAI_TRANSCRIPTION_MODEL = previousModel
  })
}
const event = { text: 'Quiero información para vivir', media: { type: 'voice', url: 'https://amojo.kommo.com/synthetic' } }

test('Whisper requests segment evidence, uses actual audio MIME and retains the caption', async t => {
  api(t, 'whisper-1', async (_url, init) => {
    assert.equal(init.body.get('response_format'), 'verbose_json')
    assert.equal(init.body.get('timestamp_granularities[]'), 'segment')
    assert.equal(init.body.get('file').name, 'audio.m4a')
    assert.equal(init.body.has('prompt'), false)
    return Response.json(whisper('Me interesa la suite 210.'))
  })
  const { mediaText } = mediaModule(Buffer.from('compressed'), 'audio/mp4')
  assert.equal(await mediaText(event), 'Quiero información para vivir\nMe interesa la suite 210.')
})

test('unclear audio throws rather than presenting an invented transcript as the caption', async t => {
  api(t, 'whisper-1', async () => Response.json(whisper('Sí, autorizo.', { no_speech_prob: 0.9 })))
  const { mediaText } = mediaModule(Buffer.from('compressed'), 'audio/ogg')
  await assert.rejects(() => mediaText(event), /AUDIO_NO_CLEAR_SPEECH/)
  assert.equal(event.text, 'Quiero información para vivir') // caller retains written text in its media-failure branch
})

test('GPT transcription requests token confidence rather than accepting plain text', async t => {
  api(t, 'gpt-4o-transcribe', async (_url, init) => {
    assert.equal(init.body.get('response_format'), 'json'); assert.equal(init.body.get('include[]'), 'logprobs')
    return Response.json({ text: 'Hola.', logprobs: [{ token: 'Hola', logprob: -0.01 }] })
  })
  assert.match(await mediaModule(Buffer.from('compressed'), 'audio/mp4').mediaText(event), /\nHola\.$/)
})

test('digital silence is rejected before an API call', async t => {
  let calls = 0
  api(t, 'whisper-1', async () => { calls++; return Response.json(whisper('Sí.')) })
  await assert.rejects(() => mediaModule(wav(), 'audio/wav').mediaText(event), /AUDIO_NO_CLEAR_SPEECH/)
  assert.equal(calls, 0)
})

test('unknown model configuration cannot bypass confidence checks', async t => {
  api(t, 'unknown-model', async () => { throw Error('Must not call API') })
  await assert.rejects(() => mediaModule(Buffer.from('compressed'), 'audio/ogg').mediaText(event), /TRANSCRIPTION_MODEL_QUALITY_UNSUPPORTED/)
})

test('the customer receives a courteous request to resend or type the unclear audio', () => {
  assert.match(mediaFailureReply(event.media, ['AUDIO_NO_CLEAR_SPEECH']), /^Disculpe,.*audio con claridad.*enviarlo de nuevo o escribirme/)
})
