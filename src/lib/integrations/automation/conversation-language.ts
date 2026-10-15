import { AsyncLocalStorage } from 'node:async_hooks'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'

export const CONVERSATION_LANGUAGE_SCHEMA = { type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', enum: ['unchanged', 'message', 'explicit'] },
    tag: { type: ['string', 'null'], description: 'Etiqueta BCP 47 del idioma de respuesta, por ejemplo en o es.' },
    evidence: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['kind', 'tag', 'evidence', 'confidence'] }

export const CONVERSATION_LANGUAGE_RULES = `conversation_language identifica el idioma de respuesta por IA, no mediante palabras clave del código. kind=explicit si pide expresamente un idioma; message si una intervención sustantiva establece o cambia el idioma; unchanged ante saludos aislados, sí/no, códigos, cifras, nombres propios, mensajes citados, emojis o contenido insuficiente. Un nombre, lugar de origen o nacionalidad no determina idioma. tag es BCP 47; evidence cita literalmente el mensaje actual. Una preferencia explícita anterior se conserva hasta que el cliente la cambie expresamente. Sin preferencia explícita, un cambio sustantivo de idioma puede actualizarla. No traduzca códigos de unidad ni convierta idioma en nacionalidad o residencia.`

function languageTag(value: unknown): string | null {
  const tag = text(value)
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(tag)) return null
  try { return Intl.getCanonicalLocales(tag)[0] || null } catch { return null }
}

export function conversationLanguage(previous: unknown, proposed: unknown, current: string): Row {
  const saved = object(previous), change = object(proposed), tag = languageTag(change.tag), evidence = text(change.evidence).trim()
  if (!tag || !['message', 'explicit'].includes(text(change.kind)) || !acceptedExtractorConfidence(change.confidence)
    || !evidence || evidence.length > 500 || !current.normalize('NFKC').toLowerCase().includes(evidence.normalize('NFKC').toLowerCase())
    || saved.kind === 'explicit' && change.kind !== 'explicit') return saved
  return { tag, kind: change.kind, evidence, confidence: change.confidence }
}

const language = new AsyncLocalStorage<{ value: Row }>()
export function withConversationLanguage<T>(work: () => Promise<T>): Promise<T> {
  return language.run({ value: {} }, work)
}
export function setConversationLanguage(value: unknown) {
  const state = language.getStore()
  if (state) state.value = object(value)
}
export function conversationLanguageInstructions(): string {
  const tag = languageTag(language.getStore()?.value.tag)
  return `\n\nIdioma del mensaje al cliente: ${tag || 'el del mensaje sustantivo actual; si es indeterminado, conserve el idioma del historial y use español solo si tampoco hay referencia'}. Redacte TODO el mensaje en ese idioma, también presentación, preguntas, financiamiento, visitas, enlaces explicados y recuperación. Esta elección prevalece sobre ejemplos o plantillas en español. No traduzca IDs, nombres propios, direcciones ni URLs. Escriba cifras con un formato claro para ese idioma. Mantenga las claves y enums del esquema JSON originales.`
}

/** Emergency delivery receipt when inference is unavailable; never a sales draft. */
export function generationRecoveryNotice(preference: unknown): string {
  return languageTag(object(preference).tag)?.split('-')[0] === 'en'
    ? 'Please allow us to check that detail with our team so we can guide you better.'
    : 'Permítanos revisar ese detalle con nuestro equipo para orientarle mejor.'
}
