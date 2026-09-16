import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { db, scope } from './data'
import { CURRENT_TONE } from './conversation-tone'
import { DEFAULT_TONE, toneDirection, toneIsDefault, type ToneSettings } from '@/lib/inmobiliaria/conversationTone'
import { readToneRow, toneState } from '@/services/conversationTone.service'

export type ToneTask = 'writing' | 'review' | 'data'
type Snapshot = { settings: ToneSettings; version: number; source: 'saved' | 'default' | 'fallback'; applied: boolean }
const turnTone = new AsyncLocalStorage<Snapshot>()
async function readSnapshot(): Promise<Snapshot> {
  try {
    const row = await readToneRow(db(), { tenantId: scope.tenant_id, projectId: scope.project_id })
    const state = toneState(row)
    return { settings: state.current, version: state.version, source: row ? 'saved' : 'default', applied: false }
  } catch {
    return { settings: DEFAULT_TONE, version: 0, source: 'fallback', applied: false }
  }
}
export async function withConversationTone<T>(work: () => Promise<T>): Promise<T> {
  return turnTone.run(await readSnapshot(), work)
}
export function conversationToneAudit() {
  const snapshot = turnTone.getStore()
  return snapshot ? { ...snapshot.settings, version: snapshot.version, source: snapshot.source, applied: snapshot.applied } : null
}

// Retain business constraints embedded alongside configurable style wording.
const replacements: Partial<Record<keyof typeof CURRENT_TONE, string>> = {
  turnLength: 'Adapte la extensión al nivel de detalle seleccionado.',
  address: 'Mantenga el trato de usted.',
  courtesy: 'No repita fórmulas ni elogie cualquier afirmación.',
  commercialWarmth: 'Resuelva lo que la persona acaba de preguntar. No repita aperturas recientes.',
  commercialLanguage: 'Evite tecnicismos como «uso mixto», «circulación comercial independiente», «unidades residenciales», «expectativa de renta» y «metraje». No atribuya parqueo a visitantes o inclusión en la compra si no consta.',
  commercialLength: 'Para una consulta sencilla, no supere 75 palabras; para varias dudas puede usar hasta 160. No omita respuestas para acortar el texto. Una pregunta como máximo; es opcional al aclarar una duda, no obligatoria.',
  projectExample: '',
  operationalIntro: 'Redacte un mensaje de coordinación de visitas o financiamiento para el cliente de La Vilet.',
  operationalWriting: 'Conteste directamente el mensaje actual. Use usted. No elogie cualquier comentario ni repita fórmulas recientes. Evite sonar a formulario.',
  operationalReview: 'Apruebe tono_natural si cumple el perfil seleccionado, trata de usted y responde al turno sin un interrogatorio. No exija ninguna palabra de cortesía en particular.',
  coverageTone: 'Trate de usted, sin «nuestra especialidad», sin preguntas de relleno, sin emojis y sin repetir una apertura reciente por obligación.',
  draftTone: 'Trate de usted, sin emojis ni identidad de asesor.',
  outsideTone: CURRENT_TONE.outsideTone
    .replace('2 frases breves, amables y naturales, normalmente 20 a 45 palabras.', 'Use solo la extensión necesaria para aclarar ese límite.')
    .replace('Incluya una cortesía breve de comprensión o disculpa; evite empezar con una negativa seca.', 'Reconozca una confusión o molestia real con tacto, según el perfil seleccionado.'),
  storedCommercialTone: 'Habla de usted. Varía las aperturas y también puedes empezar directamente con la respuesta.',
  storedCourtesy: 'No repitas fórmulas ni elogies una queja, un presupuesto insuficiente o cualquier afirmación por costumbre.',
  storedLength: 'Conteste todas las dudas sin sacrificar respuestas por un límite de palabras.',
  storedReviewerTone: 'Evalúe la redacción según el perfil seleccionado. No exija cortesías ni agradecimientos.',
  openingInstructions: 'No copie la misma apertura en turnos consecutivos ni rote mecánicamente muletillas. Resuelva la consulta concreta sin inventar preferencias, beneficios o emociones. No elogie dudas, dificultades económicas ni quejas.\n',
  openingOptional: 'Adapte la apertura al perfil seleccionado y al mensaje actual.',
}
export async function configuredToneInstructions(instructions: string, override?: ToneSettings, task: ToneTask = 'data') {
  if (task === 'data') return instructions
  const snapshot = override ? null : turnTone.getStore() ?? await readSnapshot()
  const settings = override ?? snapshot!.settings
  if (snapshot) snapshot.applied = true
  if (toneIsDefault(settings)) return instructions
  for (const [key, replacement] of Object.entries(replacements)) {
    if (settings.style === 'actual' && ['commercialLanguage', 'projectExample'].includes(key)) continue
    instructions = instructions.split(CURRENT_TONE[key as keyof typeof CURRENT_TONE]).join(replacement)
  }
  return instructions + toneDirection(settings)
}
