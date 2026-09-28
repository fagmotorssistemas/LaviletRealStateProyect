import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { leadIntroductionIssues, leadIntroductionTurn, PROFILE_INVITATION, type LeadIntroductionInput } from './lead-introduction'
import { BROCHURE_URL } from './project-material'

const catalog = [
  { id: 'a201', unit_number: '201', category: 'departamento', bedrooms: 2, price: 210000 },
  { id: 'a901', unit_number: '901', category: 'departamento', bedrooms: 3, price: 310000 },
  { id: 's305', unit_number: '305', category: 'suite', bedrooms: 1, price: 120000 },
]
const input = (overrides: Partial<LeadIntroductionInput> = {}): LeadIntroductionInput => ({
  current: 'Quiero información', history: [], summary: {}, extracted: {}, catalog,
  reply: `La Vilet reúne suites, departamentos y locales. Aquí está el brochure: ${BROCHURE_URL}\n¿Le gustaría conocer alguna de estas opciones?`,
  audit: { source: 'project_overview' }, ...overrides,
})
const begin = () => leadIntroductionTurn(input())
const pending = (overrides: Partial<LeadIntroductionInput> = {}) => input({
  current: 'Me llamo Juan', summary: { _lead_introduction: begin().state },
  extracted: { lead_profile: { full_name: 'Juan' } },
  reply: '¿Qué planta prefiere?', audit: { source: 'catalog_search' }, ...overrides,
})

describe('progressive lead introduction', () => {
  it('waits after a greeting and starts on the first substantive request after greeting', () => {
    const greeting = leadIntroductionTurn(input({ current: 'Hola', reply: 'Hola, un gusto saludarle. ¿En qué podemos ayudarle?', audit: { source: 'greeting' } }))
    assert.equal(greeting.applied, false)
    const turn = leadIntroductionTurn(input({ history: [
      { role: 'cliente', content: 'Hola' },
      { role: 'bot', content: 'Hola, un gusto saludarle. ¿En qué podemos ayudarle?' },
    ] }))
    assert.equal(turn.applied, true)
    assert.match(turn.reply, /Puertas del Sol, Cuenca/)
    assert.ok(turn.reply.endsWith(PROFILE_INVITATION))
    assert.doesNotMatch(turn.reply, /suite|departamento|penthouse|locales|https:\/\//i)
    assert.equal((turn.reply.match(/\?/g) || []).length, 1)
    assert.equal(turn.state.status, 'pending')
  })
  it('answers category interest briefly using the entire verified category catalog', () => {
    const turn = leadIntroductionTurn(input({ current: 'Hola, me interesan los departamentos',
      extracted: { preferred_category: 'departamento' }, audit: { source: 'catalog_search' },
      reply: 'Departamento 201 de 2 dormitorios. Departamento 901 de 3 dormitorios. ¿Qué planta prefiere?' }))
    assert.match(turn.reply, /departamentos de 2 y 3 dormitorios/)
    assert.doesNotMatch(turn.reply, /201|901|planta/)
    assert.ok(turn.reply.endsWith(PROFILE_INVITATION))
  })
  it('does not substitute an unrelated category summary for an actual price answer', () => {
    const turn = leadIntroductionTurn(input({ current: '¿Qué precio tienen los departamentos de 3 dormitorios?',
      extracted: { preferred_category: 'departamento', preferred_bedrooms: 3 },
      reply: 'Los departamentos de 3 dormitorios tienen precios referenciales desde $310.000; pueden cambiar. ¿Qué planta prefiere?',
      audit: { source: 'unit_price' } }))
    assert.match(turn.reply, /\$310\.000/)
    assert.match(turn.reply, /pueden cambiar/)
    assert.doesNotMatch(turn.reply, /Qué planta/)
    assert.ok(turn.reply.endsWith(PROFILE_INVITATION))
  })
  it('gives the brochure and resumes category-specific continuity when both facts arrive', () => {
    const first = leadIntroductionTurn(input({ current: 'Me interesan los departamentos',
      extracted: { preferred_category: 'departamento' }, audit: { source: 'catalog_search' } }))
    const turn = leadIntroductionTurn(pending({ current: 'Soy Carlos y vivo en Madrid',
      summary: { _lead_introduction: first.state },
      extracted: { lead_profile: { full_name: 'Carlos', residence_city: 'Madrid' } } }))
    assert.match(turn.reply, /brochure/)
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.match(turn.reply, /Cuántos dormitorios está buscando/)
    assert.doesNotMatch(turn.reply, /su nombre|reside|suite|local|Qué planta/)
    assert.equal(turn.state.status, 'complete')
  })
  it('asks only the missing residence after receiving a name, with one reminder maximum', () => {
    const turn = leadIntroductionTurn(pending())
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.match(turn.reply, /guía personalizada.*en qué ciudad o país reside actualmente/)
    assert.doesNotMatch(turn.reply, /su nombre|desde dónde|desde qué/)
    assert.equal(turn.state.reminder_count, 1)
    const following = leadIntroductionTurn(pending({ current: 'Vivo en Cuenca',
      summary: { _lead_introduction: turn.state, _lead_profile: { full_name: 'Juan' } },
      extracted: { lead_profile: { full_name: null, residence_city: 'Cuenca' } } }))
    assert.equal(following.state.status, 'complete')
    assert.doesNotMatch(following.reply, /https:\/\/|su nombre|reside actualmente/)
    assert.match(following.reply, /suites, departamentos, penthouses y locales comerciales/)
    assert.match(following.reply, /información de alguna de estas opciones/)
  })
  it('accepts country-only residence and asks only the missing name', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Vivo en Estados Unidos',
      extracted: { lead_profile: { residence_country: 'Estados Unidos' } } }))
    assert.match(turn.reply, /podría indicarnos su nombre/)
    assert.doesNotMatch(turn.reply, /reside actualmente/)
    assert.ok(turn.reply.includes(BROCHURE_URL))
  })
  it('answers an ignored-profile price question and releases the brochure without another profile demand', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Pero dígame el precio de los de 3 dormitorios',
      extracted: { preferred_category: 'departamento', preferred_bedrooms: 3 },
      audit: { source: 'unit_price' },
      reply: 'Los departamentos de 3 dormitorios cuestan desde $310.000. Estos precios son referenciales.' }))
    assert.match(turn.reply, /3 dormitorios.*\$310\.000/)
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.doesNotMatch(turn.reply, /su nombre|reside|suites|Qué planta/)
    assert.equal(turn.state.status, 'complete')
  })
  it('respects profile refusal without blocking the brochure or continuing to collect', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Prefiero no dar mis datos', extracted: {} }))
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.doesNotMatch(turn.reply, /podría indicarnos|su nombre|reside/)
    assert.equal(turn.state.status, 'complete')
  })
  it('never holds an explicitly requested brochure', () => {
    const turn = leadIntroductionTurn(input({ current: 'Envíeme el brochure', audit: { source: 'brochure' },
      reply: `Aquí tiene el brochure: ${BROCHURE_URL}` }))
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.equal(turn.brochureDeferred, false)
    assert.equal(turn.state.status, 'complete')
  })
  it('does not restart profiling in an existing conversation or interrupt an operational request', () => {
    for (const override of [
      { history: [{ role: 'cliente', content: 'Me interesa el 901' }, { role: 'bot', content: 'El 901 cuenta con 3 dormitorios.' }] },
      { audit: { source: 'visit_intake' }, current: 'Quiero una cita para mañana' },
      { audit: { source: 'financing' }, current: 'Quiero que revisen el crédito' },
      { summary: { _lead_introduction: { status: 'complete' } } },
    ]) assert.equal(leadIntroductionTurn(input(override)).applied, false)
  })
  it('keeps verified category facts without copying promotional claims from the desired wording', () => {
    const turn = leadIntroductionTurn(input())
    assert.doesNotMatch(turn.reply, /mayor plusvalía|terrazas privadas|iluminación natural|vanguardista/)
    const known = leadIntroductionTurn(input({ profile: { full_name: 'Ana', residence_country: 'Chile' } }))
    assert.ok(known.reply.includes(BROCHURE_URL))
    assert.doesNotMatch(known.reply, /podría indicarnos/)
  })
  it('validates the opening purpose, residence wording, category timing and brochure delivery', () => {
    const turn = begin()
    assert.deepEqual(leadIntroductionIssues(turn.reply, turn.audit), [])
    assert.ok(leadIntroductionIssues(turn.reply.replace('reside actualmente', 'nos escribe'), turn.audit).includes('lead_profile_question_changed'))
    assert.ok(leadIntroductionIssues(turn.reply + ' Tenemos departamentos.', turn.audit).includes('lead_profile_categories_premature'))
    assert.ok(leadIntroductionIssues(turn.reply + BROCHURE_URL, turn.audit).includes('lead_profile_brochure_premature'))
    const delivered = leadIntroductionTurn(pending())
    assert.deepEqual(leadIntroductionIssues(delivered.reply, delivered.audit), [])
    assert.ok(leadIntroductionIssues(delivered.reply.replace(BROCHURE_URL, ''), delivered.audit).includes('lead_profile_brochure_missing'))
  })
})
