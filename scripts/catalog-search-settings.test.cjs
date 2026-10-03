const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const Module = require('node:module')
let authenticated = true, writes = [], reads = [], conflict = false
let project = { id: 'project', tenant_id: 'tenant', name: 'La Vilet', updated_at: 'version-1',
  policies_json: { pricing: { visible: true }, business_policies: { items: [] } } }
const supabase = { from(table) {
  let patch = null
  const filters = []
  const chain = {
    select() { return chain },
    eq(key, value) { filters.push([key, value]); return chain },
    single: async () => { reads.push({ table, filters }); return { data: project, error: null } },
    update(value) { patch = value; return chain },
    then(resolve) {
      writes.push({ table, patch, filters })
      if (conflict) return Promise.resolve({ data: [], error: null }).then(resolve)
      project = { ...project, ...patch }
      return Promise.resolve({ data: [{ updated_at: project.updated_at }], error: null }).then(resolve)
    },
  }
  return chain
} }
const original = Module._load
Module._load = function(id, parent, main) {
  if (id === '@/lib/auth/session') return {
    assertAdmin: async () => { if (!authenticated) throw Error('Solo administradores'); return { user: { id: 'admin' } } },
    getSessionUser: async () => ({ supabase }),
  }
  return original.call(this, id, parent, main)
}
const actions = require('../src/app/inmobiliaria/automatizacion/conocimiento/actions.ts')
Module._load = original

test('setting is persisted on/off through the authenticated action and reloaded', async () => {
  assert.equal((await actions.loadBusinessPolicies('project')).catalogSearch.embeddingsEnabled, false)
  const on = await actions.saveCatalogSearch('project', true, project.updated_at)
  assert.equal(on.catalogSearch.embeddingsEnabled, true)
  assert.equal((await actions.loadBusinessPolicies('project')).catalogSearch.embeddingsEnabled, true)
  assert.deepEqual(project.policies_json.pricing, { visible: true })
  assert.deepEqual(writes[0].filters, [['id', 'project'], ['tenant_id', 'tenant'], ['updated_at', 'version-1']])
  const off = await actions.saveCatalogSearch('project', false, project.updated_at)
  assert.equal(off.catalogSearch.embeddingsEnabled, false)
  assert.equal((await actions.loadBusinessPolicies('project')).catalogSearch.embeddingsEnabled, false)
  assert.equal(reads.every(read => read.table === 'projects'), true)
})

test('unauthorized, stale, invalid and concurrent updates never report a saved state', async () => {
  const before = writes.length
  authenticated = false
  await assert.rejects(actions.saveCatalogSearch('project', true, project.updated_at), /administradores/)
  authenticated = true
  await assert.rejects(actions.saveCatalogSearch('project', true, 'obsolete'), /cambió/)
  await assert.rejects(actions.saveCatalogSearch('project', 'true', project.updated_at), /activar o desactivar/)
  assert.equal(writes.length, before)
  conflict = true
  await assert.rejects(actions.saveCatalogSearch('project', true, project.updated_at), /cambió/)
  assert.equal(project.policies_json.catalog_search.embeddings_enabled, false)
})
