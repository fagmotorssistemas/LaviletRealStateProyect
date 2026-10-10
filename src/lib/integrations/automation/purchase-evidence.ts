import { object, text } from './data'
import { normalized } from './sdr-rules'

const preamble = /^(?:(?:hola|saludos|buenos dias|buenas tardes|buenas noches|si|claro|bueno|entiendo|entendido|gracias|por favor|perfecto|de acuerdo)\s+)+/
const purchaseDecision = /\b(?:comprar|compra|adquirir|invertir|inversion|negocio|mudarm[ea]|mudarnos)\b|\b(?:busco|quiero|quisiera|deseo|necesito|prefiero|me interesa|estoy buscando)\b[^.!?]*(?:\bvivienda\b|\bsuite\b|\bdepartamento\b|\bpenthouse\b|\blocal\b|\bvivir\b)/
const explicitPurposeAnswer = /^(?:(?:para|como)\s+)?(?:vivir|inversion|invertir|negocio|segunda vivienda|(?:mis?\s+)?vacaciones|arrendar(?:lo)?|alquilar(?:lo)?)$/
const anotherClause = /\b(?:y|pero|aunque|ademas|tambien|porque|para|sin embargo|seria|busco|quiero|quisiera|deseo|necesito|prefiero|me interesa)\b/
const explicitPropertyScope = /\b(?:viviendas?|residenciales?|suites?|departamentos?|penthouses?|locales?|dormitorios?|habitaciones?)\b/

/** A literal citation must support the kind of declaration it is used for.
 * Greetings around a present residence or a general information request do not
 * turn either into the intended use of a future purchase. Mixed statements with
 * an independent purchase decision deliberately remain with the interpreter. */
export function isPassivePurchaseEvidence(evidence: unknown): boolean {
  let value = normalized(text(evidence))
  if (!value) return false
  value = value.replace(preamble, '').replace(/(?:\s+(?:por favor|gracias))+$/, '')
  const generalInformation = /^(?:(?:solo|solamente|unicamente|por ahora)\s+)?(?:(?:quiero|quisiera|deseo|necesito|busco|me interesa)\s+(?:tener\s+|recibir\s+|conocer\s+|obtener\s+|mas\s+)?)?(?:informacion|info|detalles)(?:\s+(?:del|sobre el|sobre la|sobre|de)\s+[a-z0-9 ]+)?$/.test(value)
  if (generalInformation && !purchaseDecision.test(value) && !explicitPropertyScope.test(value)) return true
  const residence = /^(?:(?:yo|nosotros|nosotras|actualmente|ahora|por ahora|hoy|todavia|aun)\s+)*(?:vivo|vivimos|resido|residimos|radico|radicamos|estoy viviendo|estamos viviendo)(?:\s+actualmente)?\s+(?:en\s+[^.!?;,]+|aqui|ahi|alli)$/.test(value)
    || /^(?:yo\s+)?soy de\s+[^.!?;,]+$/.test(value)
  // Do not swallow an independent clause as part of a location. Its intention
  // may use ordinary language such as renting it out or spending holidays there.
  return residence && !anotherClause.test(value) && !purchaseDecision.test(value)
}

/** Typed current request meaning is a second, vocabulary-independent source.
 * A pure overview with no separate preference or intended-use declaration
 * cannot establish the client's search group, even if the model supplies one. */
export function isGeneralProjectOverviewWithoutPurchaseScope(raw: unknown, current: string): boolean {
  const data = object(raw), semantics = object(data.turn_semantics), property = object(semantics.property)
  const requests = Array.isArray(data.requests) ? data.requests.map(object) : []
  const source = normalized(current), request = requests[0]
  const meaningful = (value: unknown): boolean => value !== null && value !== undefined
    && (Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? !!value.trim() : true)
  if (semantics.primary_intent !== 'project_information' || semantics.confidence !== 'high'
    || requests.length !== 1 || request.domain !== 'property' || request.confidence !== 'high'
    || !Array.isArray(request.topics) || request.topics.length !== 1 || request.topics[0] !== 'project_overview'
    || !normalized(text(request.evidence)) || !source.includes(normalized(text(request.evidence)))
    || property.operation !== 'none' || meaningful(property.category) || meaningful(property.selector)
    || meaningful(property.unit_numbers) || meaningful(property.excluded_categories)
    || Object.values(object(property.filters)).some(meaningful)
    || meaningful(semantics.housing_quantities)) return false
  const overview = normalized(text(request.evidence))
  const declarations = object(data.declaration_evidence)
  const independentSource = (evidence: unknown) => {
    const quote = normalized(text(evidence))
    return !!quote && source.includes(quote) && quote !== overview && !isPassivePurchaseEvidence(quote)
  }
  if (data.purchase_purpose && (independentSource(declarations.purchase_purpose)
    || purchaseDecision.test(normalized(text(declarations.purchase_purpose)))
    || explicitPurposeAnswer.test(normalized(text(declarations.purchase_purpose))))) return false
  if (data.preferred_category && independentSource(declarations.preferred_category)) return false
  return !purchaseDecision.test(normalized(text(property.evidence)))
}

/** A profile answer may be a bare acknowledgement or a name, without repeating
 * the residence verb. Bind that source to the actual pending profile question;
 * a yes to purchase purpose elsewhere is not a profile-only answer. */
export function isPassiveProfilePurposeEvidence(raw: unknown, pendingRaw: unknown, evidence: unknown): boolean {
  const data = object(raw), pending = object(pendingRaw), answer = object(object(data.turn_semantics).answer_to_previous)
  const quote = normalized(text(evidence))
  if (!quote || !['lead_profile', 'lead_profile_name', 'lead_profile_residence', 'lead_residence_confirmation'].includes(text(pending.id))
    || answer.question_id !== pending.id || answer.confidence !== 'high' || !['affirmative', 'negative', 'value'].includes(text(answer.kind))
    || normalized(text(answer.evidence)) !== quote || purchaseDecision.test(quote)) return false
  const acknowledgement = /^(?:(?:si|no|claro|bueno|correcto|exacto|asi es|de acuerdo|gracias|por favor|ahi|alli)\s*)+$/.test(quote)
  if (!acknowledgement && anotherClause.test(quote)) return false
  const profileQuotes = [object(data.profile_evidence).full_name, object(data.profile_evidence).residence_city,
    object(data.profile_evidence).residence_country, object(data.declared_location).evidence, object(data.residence_confirmation).evidence]
  return acknowledgement || profileQuotes.some(profileQuote => normalized(text(profileQuote)) === quote)
}

export const PURCHASE_EVIDENCE_RULES = `SEPARE PERFIL, FINALIDAD Y BÚSQUEDA: residencia actual, origen y destino de compra son datos distintos. «Sí, yo vivo en Cuenca» declara o confirma residencia; no declara purchase_purpose=vivir, no genera declared_purchase_purpose ni elige property.group=residential. Un sí a nombre o residencia responde únicamente a esa pregunta. «Vivo en Cuenca y busco una vivienda para invertir» sí aporta residencia y una intención inmobiliaria independiente: conserve ambas con sus citas propias, sin borrar la finalidad conocida. purchase_purpose identifica cómo pretende usar lo que compre; property.group identifica si busca vivienda o comercio; ninguno se completa sólo porque el proyecto ofrece viviendas. «Saludos, quiero información por favor» es información general del proyecto: group/category=null, operation=none, sin finalidad de compra. Una consulta general no elige vivienda, inversión ni local y no borra preferencias reales ya confirmadas. Extraiga únicamente las novedades del mensaje actual; la memoria conserva las decisiones anteriores.`
