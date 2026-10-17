import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { turnCommunicationKind } from './turn-communication'

const categories = new Set(['suite', 'departamento', 'penthouse', 'local'])
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const literal = (value: unknown) => text(value).trim()
const grounded = (value: unknown, current: string) => !!literal(value) && current.includes(literal(value))

/** The model identifies which categories are excluded. The server validates
 * enum membership and literal source, never recognizes category words. */
export function groundedCurrentCategoryExclusions(propertyRaw: unknown, current: string, pendingRaw: unknown = {}): string[] {
  void pendingRaw
  const property = object(propertyRaw)
  if (!acceptedExtractorConfidence(property.confidence) || !grounded(property.evidence, current)) return []
  const individual = rows(property.exclusion_evidence)
  return [...new Set(Array.isArray(property.excluded_categories) ? property.excluded_categories.map(text) : [])]
    .filter(category => categories.has(category)
      && grounded(individual.find(proof => proof.category === category)?.evidence || property.evidence, current))
}

/** An evidence string alone has no semantic authority. Typed social meaning
 * can establish that the source was not a purchase declaration. */
export function isPassivePurchaseEvidence(evidence: unknown, interpreted: unknown = {}): boolean {
  void evidence
  const raw = object(interpreted), semantics = object(raw.turn_semantics || raw.semantica_turno || raw)
  const kind = turnCommunicationKind(semantics)
  return kind !== null && kind !== 'substantive'
}

/** A pure, typed overview cannot establish a search group by itself. Distinct
 * current declarations keep their independent literal evidence. */
export function isGeneralProjectOverviewWithoutPurchaseScope(raw: unknown, current: string): boolean {
  const data = object(raw), semantics = object(data.turn_semantics), property = object(semantics.property)
  const requests = rows(data.requests), request = requests[0]
  const meaningful = (value: unknown): boolean => value !== null && value !== undefined
    && (Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? !!value.trim() : true)
  if (semantics.primary_intent !== 'project_information' || !acceptedExtractorConfidence(semantics.confidence)
    || requests.length !== 1 || request.domain !== 'property' || !acceptedExtractorConfidence(request.confidence)
    || !Array.isArray(request.topics) || request.topics.length !== 1 || request.topics[0] !== 'project_overview'
    || !grounded(request.evidence, current)
    || property.operation !== 'none' || meaningful(property.category) || meaningful(property.selector)
    || meaningful(property.unit_numbers) || meaningful(property.excluded_categories)
    || Object.values(object(property.filters)).some(meaningful)
    || meaningful(semantics.housing_quantities)) return false
  const overview = literal(request.evidence), declarations = object(data.declaration_evidence)
  const independentSource = (evidence: unknown) => grounded(evidence, current) && literal(evidence) !== overview
  return !(data.purchase_purpose && independentSource(declarations.purchase_purpose))
    && !(data.preferred_category && independentSource(declarations.preferred_category))
}

/** A response bound to a delivered profile question is not simultaneously an
 * answer to purchase purpose. Separate current declarations remain possible. */
export function isPassiveProfilePurposeEvidence(raw: unknown, pendingRaw: unknown, evidence: unknown): boolean {
  const data = object(raw), pending = object(pendingRaw), answer = object(object(data.turn_semantics).answer_to_previous)
  const quote = literal(evidence)
  if (!quote || !['lead_profile', 'lead_profile_name', 'lead_profile_residence', 'lead_residence_confirmation'].includes(text(pending.id))
    || answer.question_id !== pending.id || !acceptedExtractorConfidence(answer.confidence)
    || !['affirmative', 'negative', 'value'].includes(text(answer.kind)) || literal(answer.evidence) !== quote) return false
  const profileQuotes = [object(data.profile_evidence).full_name, object(data.profile_evidence).residence_city,
    object(data.profile_evidence).residence_country, object(data.declared_location).evidence, object(data.residence_confirmation).evidence]
  return profileQuotes.some(profileQuote => literal(profileQuote) === quote)
}

/** Kept for stored/test API compatibility. Asset words cannot be parsed to
 * veto a purpose; the common semantic interpreter owns that distinction. */
export function isAssetOnlyPurposeEvidence(raw: unknown, pendingRaw: unknown, evidence: unknown): boolean {
  void raw
  void pendingRaw
  void evidence
  return false
}

export const PURCHASE_EVIDENCE_RULES = `SEPARE PERFIL, FINALIDAD Y BUSQUEDA: residencia actual, origen y destino de compra son datos distintos. Un saludo no declara interes de compra. Una respuesta a nombre o residencia responde solo esa pregunta y no establece la finalidad del inmueble. La IA determina semanticamente categoria, finalidad y papel de cada cita; el codigo solo valida el contrato y la procedencia literal.
purchase_purpose identifica el uso futuro declarado de lo que compre; property.group identifica vivienda o comercio y property.category su tipologia. Esos datos son independientes. Pedir informacion general no elige vivienda, inversion ni local y no borra preferencias anteriores. Una categoria, superficie o numero de dormitorios no indica para que utilizara el inmueble. Un mensaje puede aportar perfil y una finalidad de compra independiente: conserve ambos con sus evidencias literales correspondientes. No extraiga del historial una declaracion nueva ni copie las preguntas del bot como decisiones del cliente. Buscar alquiler para usarlo no es comprar para arrendar a terceros. Extraiga unicamente novedades actuales, manteniendo las decisiones ya confirmadas por separado.`
