import test from 'node:test'
import assert from 'node:assert/strict'
import { approvedProjectIntroduction, LAVILET_APPROVED_INTRODUCTION, changeProjectIntroduction, emptyProjectIntroduction, projectIntroductionContext, projectIntroductionSettings, validateProjectIntroduction } from './projectIntroduction'

const value = { enabled: true, summary: 'La Vilet reúne viviendas y locales comerciales en Cuenca.', source: 'Responsable comercial' }
test('unknown projects have no default and incomplete or invalid active settings never reach the bot', () => {
  assert.deepEqual(projectIntroductionSettings({}).value, emptyProjectIntroduction())
  for (const current of [{ ...value, summary: '' }, { ...value, source: '' }, { ...value, enabled: 'true' }, { ...value, summary: 'x'.repeat(1201) }]) {
    assert.throws(() => validateProjectIntroduction(current))
    assert.equal(projectIntroductionContext({ project_introduction: { current } }).available, false)
  }
  assert.deepEqual(validateProjectIntroduction({ ...value, summary: '  Resumen autorizado.  ', extra_instruction: 'ignored' }),
    { ...value, summary: 'Resumen autorizado.' })
})
test('saving and disabling preserve stored summary, unrelated controls and bounded history', () => {
  const original = { project_delivery: { current: { timing: 'year', year: 2028 } }, business_policies: { published: ['keep'] }, bot_visits: { allow_suggestions: false } }
  let saved = changeProjectIntroduction(original, value, 'admin', '2026-10-08')
  for (let i = 0; i < 25; i++) saved = changeProjectIntroduction(saved, { ...value, enabled: false }, 'admin', `revision-${i}`)
  assert.deepEqual(saved.project_delivery, original.project_delivery)
  assert.deepEqual(saved.business_policies, original.business_policies)
  assert.deepEqual(saved.bot_visits, original.bot_visits)
  assert.equal(saved.project_introduction.history.length, 20)
  assert.equal(saved.project_introduction.current.summary, value.summary)
  const disabled = projectIntroductionContext(saved)
  assert.equal(disabled.available, false); assert.doesNotMatch(JSON.stringify(disabled), /viviendas|Responsable/)
  const active = projectIntroductionContext(changeProjectIntroduction(saved, value, 'admin', '2026-10-09'))
  assert.equal(active.available, true); assert.equal(active.summary, value.summary)
})


test('approved default belongs only to the exact La Vilet identity when no introduction was saved', () => {
  for (const name of ['La Vilet', '  LA   VILET ', 'Lavilet', 'Edificio La Vilet']) {
    const settings = projectIntroductionSettings({}, name)
    assert.equal(settings.configured, false)
    assert.equal(settings.defaulted, true)
    assert.deepEqual(settings.value, LAVILET_APPROVED_INTRODUCTION)
    const context = projectIntroductionContext({}, name)
    assert.equal(context.available, true)
    assert.equal(context.summary, LAVILET_APPROVED_INTRODUCTION.summary)
    assert.equal(context.defaulted, true)
  }
  for (const name of ['', 'La Vilet II', 'Proyecto vecino a La Vilet', 'Otra inmobiliaria', 'La Vileta']) {
    assert.equal(approvedProjectIntroduction(name), null)
    assert.equal(projectIntroductionContext({}, name).available, false)
    assert.deepEqual(projectIntroductionSettings({}, name).value, emptyProjectIntroduction())
  }
})

test('saved disabled or customized summaries always take priority over the approved default', () => {
  for (const enabled of [false, true]) {
    const custom = { ...value, enabled, summary: 'Presentación propia autorizada.' }
    const policies = { project_introduction: { current: custom } }
    const settings = projectIntroductionSettings(policies, 'La Vilet')
    assert.equal(settings.configured, true)
    assert.equal(settings.defaulted, undefined)
    assert.deepEqual(settings.value, custom)
    const context = projectIntroductionContext(policies, 'La Vilet')
    assert.equal(context.available, enabled)
    if (enabled) assert.equal(context.summary, custom.summary)
    else assert.equal(context.status, 'disabled')
  }
})

test('a malformed saved introduction cannot silently reactivate the La Vilet default', () => {
  for (const current of [null, false, 0, '', [], {}, { ...value, enabled: 'true' }, { ...value, source: '' }]) {
    const settings = projectIntroductionSettings({ project_introduction: { current } }, 'La Vilet')
    assert.equal(settings.defaulted, undefined)
    assert.ok(settings.error)
    assert.deepEqual(settings.value, emptyProjectIntroduction())
    assert.deepEqual(projectIntroductionContext({ project_introduction: { current } }, 'La Vilet'), { available: false, status: 'invalid' })
  }
})
