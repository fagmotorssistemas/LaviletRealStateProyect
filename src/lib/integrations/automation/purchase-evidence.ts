import { object, text } from './data'
import { normalized } from './sdr-rules'

const preamble = /^(?:(?:hola|saludos|buenos dias|buenas tardes|buenas noches|si|claro|bueno|entiendo|entendido|gracias|por favor|perfecto|de acuerdo)\s+)+/
const purchaseDecision = /\b(?:comprar|compra|adquirir|invertir|inversion|negocio|mudarm[ea]|mudarnos)\b|\b(?:busco|quiero|quisiera|deseo|necesito|prefiero|me interesa|estoy buscando)\b[^.!?]*(?:\bvivienda\b|\bsuite\b|\bdepartamento\b|\bpenthouse\b|\blocal\b|\bvivir\b)/
const explicitPurposeAnswer = /^(?:(?:para|como)\s+)?(?:vivir|inversion|invertir|negocio|segunda vivienda|(?:mis?\s+)?vacaciones|arrendar(?:lo)?|alquilar(?:lo)?)$/
const anotherClause = /\b(?:y|pero|aunque|ademas|tambien|porque|para|sin embargo|seria|busco|quiero|quisiera|deseo|necesito|prefiero|me interesa)\b/
const explicitPropertyScope = /\b(?:viviendas?|residenciales?|suites?|departamentos?|penthouses?|locales?|dormitorios?|habitaciones?)\b/

/** Remove only independently supported profile clauses. A full-message name
 * citation is not itself proof that everything in that message is a name. */
function withoutPassiveProfileClauses(raw: unknown, quote: string): string {
  const data = object(raw), profile = object(data.profile_evidence)
  const name = normalized(text(data.full_name))
  const nameEvidence = normalized(text(profile.full_name))
  return quote.split(/\s+(?:y|pero|ademas|tambien)\s+/).filter(clause => {
    if (isPassivePurchaseEvidence(clause)) return false
    const value = clause.replace(preamble, '')
    const namePrefix = /^(?:yo\s+)?(?:soy|me llamo|mi nombre es|mi nombre completo es)\s+/
    const declaredName = value.replace(namePrefix, '')
    const supportedName = !!name && !!nameEvidence && (nameEvidence.includes(clause) || nameEvidence === name)
      && (declaredName === name && (namePrefix.test(value) || value === name))
    return !supportedName
  }).join(' ').trim()
}

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
  // A name plus a residence is still a profile answer. Previously any "y"
  // prevented this guard from checking the two independently passive clauses.
  if (!acknowledgement && anotherClause.test(quote)) return !withoutPassiveProfileClauses(data, quote)
  const profileQuotes = [object(data.profile_evidence).full_name, object(data.profile_evidence).residence_city,
    object(data.profile_evidence).residence_country, object(data.declared_location).evidence, object(data.residence_confirmation).evidence]
  return acknowledgement || profileQuotes.some(profileQuote => normalized(text(profileQuote)) === quote)
}

const assetScopeTerms = new Set(('vivienda viviendas residencial residenciales casa casas suite suites departamento departamentos apartamento apartamentos penthouse penthouses local locales comercial comerciales dormitorio dormitorios habitacion habitaciones cuarto cuartos').split(' '))
const assetScopeWords = new Set(('yo nosotros nosotras me mi mis para de del la las el los un una unos unas algo tipo tipos unidad unidades y o tambien mas menos con sin en este esta eso esa esos esas lo le si no por favor gracias buenos dias buenas tardes noches hola saludos claro bueno entiendo entendido perfecto busco buscamos buscar buscando quiero queremos quisiera quisieramos deseo deseamos necesito necesitamos prefiero preferimos interesa interesan interesado interesada estamos estoy seria es son sea comprar compra adquirir adquirirlo tenemos tengo disponible disponibles opciones opcion cuantos cuantas dos tres cuatro cinco seis uno primera segunda tercera cuarta quinta sexta planta plantas piso pisos baja bajo bajos alta alto altos minimo minima minimos maximo maxima maximos al').split(' '))

/** An asset, category or physical requirement is not the intended use of a
 * purchase. Reject only demonstrably scope-only citations; independent use
 * clauses remain with the semantic interpreter, including ordinary wording
 * outside an enumerated list of purpose phrases. */
export function isAssetOnlyPurposeEvidence(raw: unknown, pendingRaw: unknown, evidence: unknown): boolean {
  const quote = normalized(text(evidence))
  if (!quote) return false
  const data = object(raw), answer = object(object(data.turn_semantics).answer_to_previous), pending = object(pendingRaw)
  // "Second home" is an intended-use description in the domain contract,
  // whereas "second floor" is only a physical requirement. Do not mistake
  // the former for an ordinal plus an otherwise neutral asset word.
  if (data.purchase_purpose === 'segunda_vivienda' && /\bsegunda vivienda\b/.test(quote)) return false
  const categoryAnswer = pending.id === 'property_category' && answer.question_id === pending.id
    && answer.confidence === 'high' && normalized(text(answer.evidence)) === quote
    && ['affirmative', 'negative', 'value'].includes(text(answer.kind))
  // The model may cite a whole mixed message. Strip only independently passive
  // profile clauses, never a real future-use clause in the same declaration.
  const scope = withoutPassiveProfileClauses(data, quote)
  const words = scope.split(' ')
  // A category-only acknowledgement can bind to the offered asset, but cannot
  // additionally accept personal occupancy or a business/investment purpose.
  const acknowledgement = categoryAnswer && /^(?:(?:si|no|claro|correcto|exacto|asi es|de acuerdo|esta bien|me parece bien|perfecto)\s*)+$/.test(quote)
  return acknowledgement || words.some(word => assetScopeTerms.has(word))
    && words.every(word => assetScopeTerms.has(word) || assetScopeWords.has(word) || /^\d+$/.test(word))
}

export const PURCHASE_EVIDENCE_RULES = `SEPARE PERFIL, FINALIDAD Y BÚSQUEDA: residencia actual, origen y destino de compra son datos distintos. «Sí, yo vivo en Cuenca» declara o confirma residencia; no declara purchase_purpose=vivir, no genera declared_purchase_purpose ni elige property.group=residential. Un sí a nombre o residencia responde únicamente a esa pregunta. «Vivo en Cuenca y busco una vivienda para invertir» sí aporta residencia y una intención inmobiliaria independiente: conserve ambas con sus citas propias, sin borrar la finalidad conocida. purchase_purpose identifica el uso futuro declarado de lo que compre; property.group identifica vivienda o comercio y property.category su tipología. Esos datos son independientes: «busco algo para vivienda» sólo identifica residential; «busco un local comercial» sólo identifica commercial/local, sin asumir vivir ni negocio propio. Inversión no elige vivienda o comercio. Asigne finalidad sólo con una declaración actual de uso o respuesta inequívoca a la pregunta REAL de finalidad, nunca por categoría, dimensiones, residencia o por lo que ofrece el proyecto. «Vivienda para vivir», «comprar para arrendarlo» y «local para mi negocio» sí declaran sus usos respectivos; buscar alquiler para usarlo no es comprar para arrendar a terceros. Una respuesta elíptica conserva el objeto de la pregunta pendiente: un sí a vivienda/local no responde también para qué la usará. Ante grupo conocido y finalidad no declarada, purchase_purpose=null y no genere declared_purchase_purpose; la memoria conserva una finalidad anterior confirmada. «Saludos, quiero información por favor» es información general del proyecto: group/category=null, operation=none, sin finalidad de compra. Una consulta general no elige vivienda, inversión ni local y no borra preferencias reales ya confirmadas. Extraiga únicamente las novedades del mensaje actual; la memoria conserva las decisiones anteriores.`
