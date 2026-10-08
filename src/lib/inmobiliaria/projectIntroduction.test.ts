import test from 'node:test'
import assert from 'node:assert/strict'
import { changeProjectIntroduction, emptyProjectIntroduction, projectIntroductionContext, projectIntroductionSettings, validateProjectIntroduction } from './projectIntroduction'

const value = { enabled: true, summary: 'La Vilet reúne viviendas y locales comerciales en Cuenca.', source: 'Responsable comercial' }
test('presentation has no fabricated default and incomplete or invalid active settings never reach the bot', () => {
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
