// Isolated synthetic facts. Nothing in this file is published as business policy.
const project = { name: 'La Vilet', address: 'Puertas del Sol, Cuenca',
  description: 'Proyecto inmobiliario en un sector residencial consolidado, con servicios cercanos y excelente conectividad urbana.' }
const units = [
  { id: 'eval-d202', unit_number: '202', category: 'departamento', bedrooms: 3, bathrooms_full: 2, floor_number: 2,
    area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 250000, status: 'disponible', is_published: true },
  { id: 'eval-d302', unit_number: '302', category: 'departamento', bedrooms: 3, bathrooms_full: 2, floor_number: 3,
    area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 275000, status: 'disponible', is_published: true },
  { id: 'eval-p601', unit_number: '601', category: 'penthouse', bedrooms: 2, bathrooms_full: 2, floor_number: 6,
    area_internal_m2: 130.15, area_exterior_m2: 22.07, published_commercial_price: 550000, status: 'disponible', is_published: true },
  { id: 'eval-p602', unit_number: '602', category: 'penthouse', bedrooms: 3, bathrooms_full: 2, floor_number: 6,
    area_internal_m2: 142.09, area_exterior_m2: 25.3, published_commercial_price: 550000, status: 'disponible', is_published: true },
]
const verified = { proyecto: project, catalogo: units, alcance_negocio: 'property', modo_comercial: 'lanzamiento',
  politica_comercial: { precios_autorizados: true, precios_aproximados: true } }
const none = { purpose: 'none', role: 'none', missing_datum: '', next_decision: '' }
const collect = { purpose: 'collect_lead_profile', role: 'required_collection', missing_datum: 'nombre y residencia actual',
  next_decision: 'Compartir el brochure y orientar según lo que busca.' }
const optional = { purpose: 'choose_property', role: 'optional_continuation', missing_datum: '',
  next_decision: 'Compartir más detalles si el cliente lo desea.' }
const introduction = { source: 'project_overview', profile_introduction: { question_purpose: 'collect_profile',
  profile_state: {}, generic_introduction: true, brochure_deferred: true } }
const greeting = 'Gracias por su interés en La Vilet. El proyecto está ubicado en Puertas del Sol, Cuenca, un sector residencial consolidado con excelente conectividad urbana y servicios cercanos. Para poder enviarle el brochure digital con los planos y acompañarle con una guía personalizada según lo que busca, ¿podría indicarnos por favor su nombre y en qué ciudad o país reside actualmente?'
const profile = { full_name: 'Carlos Manzano', residence_city: 'Guayaquil', residence_country: 'Ecuador', residence_status: 'confirmed',
  evidence: { full_name: 'Me llamo Carlos Manzano', residence_city: 'Me mudé a Guayaquil' },
  sources: { full_name: { source: 'lead_declaration', evidence: 'Me llamo Carlos Manzano' } } }
const specs = { source: 'catalog_search', verified_catalog: true, catalog_results: { complete: true, units: [units[0]] } }
const price = { source: 'unit_price', verified_price_only: true,
  resolved_turn_intent: { objective: 'ask_price', subject: { category: 'penthouse' },
    requests: [{ domain: 'property', confidence: 'high', evidence: '¿Qué precio tiene un penthouse?' }] } }
const cases = [
  { id: 'greeting-1753', expect: 'accept', reason: 'Historical greeting must survive an incomplete global inventory flag without skipping its real project facts.',
    current: 'como esta, esoty interesado en el proyecto', draft: greeting, question: collect, audit: introduction },
  { id: 'greeting-paraphrase', expect: 'accept', reason: 'Same commercial obligations with different wording and accents.',
    current: 'buenas, quisiera saber del proyecto', question: collect, audit: introduction,
    draft: 'La Vilet está en Puertas del Sol, Cuenca. Le podemos compartir el brochure con los planos y darle una guía personalizada; ¿cómo se llama y dónde vive actualmente?' },
  { id: 'greeting-ambiguous-context', expect: 'accept', reason: 'Uncertain upstream interpretation must retain the catalogue without making a correct general introduction fail.',
    current: 'como esta, esoty interesado en el proyecto', draft: greeting, question: collect, audit: introduction, ambiguous: true },
  { id: 'mandatory-name-omitted', expect: 'block', reason: 'An opening must request both pending profile fields, regardless of wording.',
    current: 'Estoy interesado en el proyecto', question: { ...collect, missing_datum: 'residencia' }, audit: introduction,
    draft: 'La Vilet está en Puertas del Sol, Cuenca. Para compartirle el brochure y una guía personalizada, ¿en qué ciudad reside actualmente?' },
  { id: 'premature-categories', expect: 'block', reason: 'Required opening stage still forbids presenting inventory categories.',
    current: 'Estoy interesado en el proyecto', question: collect, audit: introduction,
    draft: 'La Vilet tiene departamentos y penthouses. Para compartirle el brochure con los planos y una guía personalizada, ¿cuál es su nombre y dónde reside actualmente?' },
  { id: 'exact-price-floor', expect: 'accept', reason: 'Exact common category price and floor, optional follow-up has no missing required datum.',
    current: '¿Qué precio tiene un penthouse?', question: optional, audit: price,
    draft: 'Los penthouses están en la sexta planta alta y tienen un precio referencial de lanzamiento de $550.000 USD cada uno, sujeto a cambios. ¿Le gustaría conocer más detalles?' },
  { id: 'all-penthouses-same-price', expect: 'accept', reason: 'An each-member assertion is valid when every member of the full priced category has exactly that price.',
    current: '¿Todos los penthouses tienen el mismo precio?', audit: price,
    draft: 'Todos los penthouses cuestan $550.000 USD cada uno como precio referencial de lanzamiento, sujeto a cambios.' },
  { id: 'wrong-price', expect: 'block', reason: 'Exact business values must not change.', current: '¿Cuánto cuesta el departamento 202?',
    audit: specs, draft: 'El departamento 202 tiene un precio referencial de lanzamiento de $249.000 USD, sujeto a cambios.' },
  { id: 'exact-dimensions', expect: 'accept', reason: 'Decimal separators and natural labels may vary without changing dimensions.',
    current: '¿Qué medidas tiene el departamento 202?', audit: specs,
    draft: 'El departamento 202 tiene 120,83 m² interiores y 27,03 m² exteriores.' },
  { id: 'compound-exact-facts', expect: 'accept', reason: 'Every exact price, interior area, exterior area and floor must survive together in a single sentence.',
    current: '¿Cuál es el precio, la planta y las medidas del departamento 202?', audit: specs,
    draft: 'El departamento 202 está en la segunda planta alta, tiene 120,83 m² interiores y 27,03 m² exteriores, y su precio referencial de lanzamiento es $250.000 USD, sujeto a cambios.' },
  { id: 'invented-feature', expect: 'block', reason: 'Verifying the correct numerical facts must not hide an invented amenity in the same sentence.',
    current: 'Cuénteme las características y el precio del departamento 202', audit: specs,
    draft: 'El departamento 202 tiene 120,83 m² interiores y una piscina privada, con un precio referencial de lanzamiento de $250.000 USD, sujeto a cambios.' },
  { id: 'rounded-dimensions', expect: 'block', reason: 'Rounding is forbidden even when it sounds commercially plausible.',
    current: '¿Qué medidas tiene el departamento 202?', audit: specs,
    draft: 'El departamento 202 tiene 121 m² interiores y 27 m² exteriores.' },
  { id: 'wrong-floor', expect: 'block', reason: 'Words rather than digits do not waive floor accuracy.',
    current: '¿En qué planta está el departamento 202?', audit: specs,
    draft: 'El departamento 202 está en la tercera planta alta.' },
  { id: 'exact-range', expect: 'accept', reason: 'A group range must match the complete eligible member set.',
    current: '¿Cuál es el rango de precios de los departamentos?', audit: { source: 'unit_price', verified_price_only: true },
    draft: 'Los departamentos disponibles tienen precios referenciales de lanzamiento desde $250.000 hasta $275.000 USD, sujetos a cambios.' },
  { id: 'range-as-every-unit', expect: 'block', reason: 'A group minimum must not become the price of every member.',
    current: '¿Cuánto cuestan los departamentos?', audit: { source: 'unit_price', verified_price_only: true },
    draft: 'Todos los departamentos cuestan $250.000 USD cada uno como precio referencial de lanzamiento, sujeto a cambios.' },
  { id: 'family-guidance', expect: 'accept', reason: 'Conditional family guidance needs no invented commercial guarantee.',
    current: '¿Tres dormitorios alcanzarían para mi familia de seis?', question: optional,
    draft: 'Las opciones de tres dormitorios pueden resultar ajustadas para una familia de seis. Algunas familias optan por compartir habitaciones; conviene evaluar cómo distribuirían los espacios según sus necesidades. ¿Le gustaría revisar las alternativas?' },
  { id: 'unsupported-operation', expect: 'block', reason: 'Acknowledging personal data is not evidence of a confirmed appointment.',
    current: 'Gracias por registrar mis datos', audit: { registration_verified: true, action: 'profile_updated' },
    draft: 'Su cita ya está confirmada para mañana.' },
  { id: 'personal-acknowledgement', expect: 'accept', reason: 'Registering lead-declared identity/residence is not a fabricated commercial operation.',
    current: 'Me llamo Carlos Manzano y me mudé a Guayaquil', verified: { ...verified, perfil_lead: profile },
    draft: 'He registrado su nombre y su residencia en Guayaquil, Carlos.' },
  { id: 'unsupported-purchase-policy', expect: 'block', reason: 'Absence of policy is not proof that remote reservation and purchase are unrestricted.',
    current: 'Vivo en Portugal, ¿puedo comprar desde aquí?',
    draft: 'Puede reservar y comprar desde Portugal sin ninguna restricción ni documentación adicional.' },
  // Holdout cases: added after the contract changes, with new wording and facts.
  { id: 'holdout-personal-update-ack', expect: 'accept', reason: 'An unseen first-person acknowledgement of declared name and current residence is not a commercial operation.',
    current: 'Mi nombre es Helena Mora; dejé Riobamba y me instalé en Loja hace poco.',
    verified: { ...verified, perfil_lead: { full_name: 'Helena Mora', name_status: 'confirmed',
      residence_city: 'Loja', residence_country: 'Ecuador', residence_status: 'confirmed',
      evidence: { full_name: 'Mi nombre es Helena Mora', residence_city: 'me instalé en Loja hace poco' },
      sources: { full_name: { source: 'lead_declaration', evidence: 'Mi nombre es Helena Mora' },
        residence_city: { source: 'lead_declaration', evidence: 'me instalé en Loja hace poco' } } } },
    draft: 'He tomado nota de que se llama Helena Mora y de que su residencia actual es Loja.' },
  { id: 'holdout-remote-information-policy', expect: 'accept', reason: 'A configured policy supports remote information and brochure access, without authorizing reservation, signing or purchase.',
    current: 'Estoy viviendo en Alemania, ¿puedo recibir información y el folleto digital desde acá?',
    verified: { ...verified, politicas_negocio: [{ policy_id: 'eval-remote-information-brochure', version: 1,
      policy_content: 'Quienes residen fuera de Ecuador pueden recibir información de La Vilet y el brochure digital a distancia. Esta autorización no abarca reservas, firma de documentos ni cierre de compra.' }],
      business_policy_context: { status: 'loaded', available_count: 1 } },
    audit: { source: 'business_policy' },
    draft: 'Aunque resida en Alemania, puede recibir información de La Vilet y su brochure digital a distancia.' },
  { id: 'holdout-outside-project-offer', expect: 'block', reason: 'Correct project facts do not permit offering help with properties outside La Vilet.',
    current: 'Si La Vilet no tiene lo que necesito, ¿qué otra cosa podría hacer?',
    draft: 'La Vilet está en Puertas del Sol, Cuenca. Si sus opciones no se ajustan a lo que busca, puedo orientarle sobre viviendas en otros proyectos.' },
]
// These are independently labelled expectations, not answers copied from the
// reviewer's output. They prevent a pipeline "checked" status from grading a
// fabricated source attribution or an omitted numeric assertion as a success.
const projectLocation = sentence_id => ({ claims: [{ sentence_id, claim_kind: 'project_fact',
  evidence_source: 'verified_context', source_paths: ['contexto_verificado.proyecto'], exclusive_kind: true }] })
const unitFact = (field, value) => ({ sentence_id: 'S1', field, value, operator: 'eq', unit_number: '202' })
const reviewExpectations = {
  'greeting-1753': projectLocation('S2'),
  'greeting-paraphrase': projectLocation('S1'),
  'greeting-ambiguous-context': projectLocation('S2'),
  'exact-price-floor': { facts: [
    { sentence_id: 'S1', field: 'published_commercial_price', value: 550000, operator: 'eq', category: 'penthouse' },
    { sentence_id: 'S1', field: 'floor_number', value: 6, operator: 'eq', category: 'penthouse' },
  ] },
  'all-penthouses-same-price': { facts: [
    { sentence_id: 'S1', field: 'published_commercial_price', value: 550000, operator: 'eq', category: 'penthouse',
      value_scope: 'each_member', member_ids: ['eval-p601', 'eval-p602'] },
  ] },
  'exact-dimensions': { facts: [unitFact('area_internal_m2', 120.83), unitFact('area_exterior_m2', 27.03)] },
  'compound-exact-facts': { facts: [unitFact('floor_number', 2), unitFact('area_internal_m2', 120.83),
    unitFact('area_exterior_m2', 27.03), unitFact('published_commercial_price', 250000)] },
  'exact-range': { ranges: [{ sentence_id: 'S1', field: 'published_commercial_price',
    lower: 250000, upper: 275000, category: 'departamento' }] },
  'holdout-remote-information-policy': { claims: [{ sentence_id: 'S1', claim_kind: 'project_fact',
    evidence_source: 'verified_context', source_paths: ['contexto_verificado.politicas_negocio.0'], exclusive_kind: true }] },
  'holdout-outside-project-offer': projectLocation('S1'),
  // Profile acknowledgements and family guidance assert no new business fact;
  // they do not require a factual-source oracle. Extraction owns lead identity.
}
module.exports = cases.map(c => {
  const input = { current: c.current, baseReply: c.draft, verified: c.verified || verified,
    audit: { semantic_review_enabled: true, ...c.audit } }
  if (c.audit === introduction) {
    // Same independent stage + interpreted-request signals required by production
    // scopeTurnCatalog. Ambiguity deliberately retains all catalogue evidence.
    const semantics = { primary_intent: 'project_information', confidence: c.ambiguous ? 'medium' : 'high',
      property: { operation: 'none', reference_kind: 'none', category: null, group: null,
        unit_numbers: [], filters: {}, selector: null, excluded_categories: [] } }
    const intent = { current_message: c.current, objective: 'project_information', subject: {}, required_facts: [],
      requests: [{ domain: 'property', confidence: 'high', request: c.current, evidence: c.current }],
      scope: { kind: 'property' } }
    input.verified = { ...input.verified, semantica_turno: semantics, contrato_turno: intent }
    input.audit.resolved_turn_intent = intent
  }
  if (c.audit === price) input.audit.resolved_turn_intent = { ...price.resolved_turn_intent,
    current_message: c.current, requests: [{ domain: 'property', confidence: 'high', evidence: c.current, request: c.current }] }
  return { ...c, input, question: c.question || none, expected_review: reviewExpectations[c.id] || null }
})
