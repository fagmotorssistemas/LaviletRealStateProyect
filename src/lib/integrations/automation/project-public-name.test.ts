import test from 'node:test'
import assert from 'node:assert/strict'
import { projectPublicName, PROJECT_NAME_WRITING_RULES } from './conversation-tone'

test('public project names normalize administrative uppercase without changing stored identity', () => {
  for (const [name, expected] of [
    ['EDIFICIO LA VILET', 'La Vilet'], ['PROYECTO TORRES DEL SOL', 'Torres del Sol'],
    ['CONJUNTO JARDINES DE LA SIERRA', 'Jardines de la Sierra'], ['CONDOMINIO RÍO VERDE', 'Río Verde'],
    ['Edificio La Vilet', 'La Vilet'], ['Altos de Santa María', 'Altos de Santa María'],
  ]) {
    const project = { id: 'unchanged-project-id', name }
    const original = structuredClone(project)
    assert.equal(projectPublicName(project), expected)
    assert.deepEqual(project, original)
  }
})

test('an explicitly configured public brand preserves its intended spelling', () => {
  assert.equal(projectPublicName({ name: 'EDIFICIO LA VILET', public_name: 'La Vilet' }), 'La Vilet')
  assert.equal(projectPublicName({ name: 'PROYECTO NEXUS', display_name: 'NEXUS II' }), 'NEXUS II')
  assert.equal(projectPublicName({ name: 'EDIFICIO RIO' }, { project_presentation: { public_name: 'Río Living' } }), 'Río Living')
  assert.equal(projectPublicName({ name: '  ALTOS   DEL SOL  ' }), 'Altos del Sol')
  assert.equal(projectPublicName({}), '')
})

test('name repetition is an instruction to the writer, not removal of facts from emitted text', () => {
  assert.match(PROJECT_NAME_WRITING_RULES, /fuente verificada/)
  assert.match(PROJECT_NAME_WRITING_RULES, /si el proyecto ya está claro/)
  assert.match(PROJECT_NAME_WRITING_RULES, /No cambie ni omita datos comerciales/)
})
