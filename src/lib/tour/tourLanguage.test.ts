import test from 'node:test'
import assert from 'node:assert/strict'
import { translateTourText } from './tourMessages'
import { buildUnitShareUrl, writeUnitQueryParam } from './unitDeepLink'
import { buildFichaSpecRows } from './fichaSpecs'
import { compareVoiceUnits } from './compareVoiceUnits'
import { parseListedOptionChoice, isConversationEnd, toVoiceCatalog } from './voiceAssist'
import { runTourVoiceAssist, synthesizeTourVoice, transcribeTourVoice } from './voiceAssistServer'
import type { TourUnitSummary } from '@/types/tour'

const units = [
  { id: 'a', unit_number: '001', status: 'disponible', floor: 'Planta Baja', bedrooms: 1, bathrooms: 1, area_total_m2: 87.97, published_commercial_price: 210000 },
  { id: 'b', unit_number: '002', status: 'reservado', floor: '1', bedrooms: 2, bathrooms: 2, area_total_m2: 95, published_commercial_price: 250000 },
] as TourUnitSummary[]

test('dynamic labels, room names and status translate without altering codes, numbers or Spanish', () => {
  assert.equal(translateTourText('Unidad LC-01', 'en'), 'Unit LC-01')
  assert.equal(translateTourText('Baño completo 2', 'en'), 'Full bathroom 2')
  assert.equal(translateTourText('1 dorm. · 2 baños · piso Planta Baja · $210k', 'en'), '1 bedroom · 2 bathrooms · Floor Ground floor · $210k')
  assert.equal(translateTourText('USD 210,000', 'en'), 'USD 210,000')
  assert.equal(translateTourText('Nombre propio del material', 'en'), 'Nombre propio del material')
  assert.equal(translateTourText('Disponible', 'es'), 'Disponible')
  assert.equal(translateTourText('DORMITORIOS', 'en'), 'BEDROOMS')
  assert.equal(buildFichaSpecRows(units[0], 'en')[0].value, '87.97 m²')
})

test('shared links carry language; switching units preserves language, view hash and router state', () => {
  assert.equal(new URL(buildUnitShareUrl('001', { origin: 'https://example.test', locale: 'en' })).searchParams.get('lang'), 'en')
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const state = { router: 'existing' }; let savedUrl = ''; let savedState: unknown
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: 'https://example.test/tour?unidad=001&lang=en&utm_source=test#floor' }, history: { state, replaceState: (next: unknown, _title: string, url: string) => { savedState = next; savedUrl = url } } } })
  try { writeUnitQueryParam('002'); assert.equal(savedUrl, '/tour?unidad=002&lang=en#floor'); assert.equal(savedState, state) }
  finally { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window') }
})

test('English voice commands and comparisons use the same units and real arithmetic', () => {
  const result = compareVoiceUnits('Compare the first and second options', toVoiceCatalog(units), ['a', 'b'], 'en')!
  assert.deepEqual(result.matches.map(unit => unit.id), ['a', 'b'])
  assert.match(result.speak, /40000 dollars more/)
  assert.match(result.speak, /7.03 more square meters/)
  assert.doesNotMatch(result.speak, /Unidad|superficie|dólares|reservado/)
  assert.equal(parseListedOptionChoice('open the second', 2), 2)
  assert.equal(parseListedOptionChoice('what does the second cost?', 2), null)
  assert.equal(isConversationEnd('thank you'), true)
})

test('simulated transcription, contextual answer and TTS all receive English', async () => {
  const oldFetch = globalThis.fetch
  const keys = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_TTS_MODEL'] as const
  const old = keys.map(key => process.env[key]); keys.forEach(key => { process.env[key] = 'simulation-only' })
  process.env.OPENAI_TTS_MODEL = 'gpt-4o-mini-tts'
  const requests: { url: string; body: unknown }[] = []
  globalThis.fetch = async (url, init) => {
    const body = init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body))
    requests.push({ url: String(url), body })
    if (String(url).endsWith('/transcriptions')) return Response.json({ text: 'How many bedrooms does unit 001 have?' })
    if (String(url).endsWith('/speech')) return new Response(new Uint8Array([1, 2, 3]))
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ speak: 'Unit 001 has one bedroom.', unit_ids: ['a'] }) }] }] })
  }
  try {
    const transcript = await transcribeTourVoice(new Blob(['simulated']), 'test.webm', 'en')
    assert.equal((requests[0].body as FormData).get('language'), 'en')
    const result = await runTourVoiceAssist({ transcript, catalog: toVoiceCatalog(units), locale: 'en' })
    assert.equal(result.speak, 'Unit 001 has one bedroom.')
    assert.match((requests[1].body as { instructions: string }).instructions, /EXCLUSIVAMENTE en inglés/)
    assert.equal((await synthesizeTourVoice(result.speak, 'en'))?.byteLength, 3)
    assert.match((requests[2].body as { instructions: string }).instructions, /English/)
  } finally {
    globalThis.fetch = oldFetch
    keys.forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i] })
  }
})
