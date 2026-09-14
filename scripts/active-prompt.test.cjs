/* eslint-disable @typescript-eslint/no-require-imports -- Test the server module without loading credentials or making requests. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/integrations/automation/ai.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const scope = { tenant_id: 'test-tenant', project_id: 'test-project' }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date())
const prompt = (overrides = {}) => ({ ...scope, name: 'respuesta_comercial', content: 'Use modo_comercial y las políticas del contexto.', is_active: true,
  channel: ['whatsapp'], valid_from: null, valid_until: null, mode: 'lanzamiento', ...overrides })

function harness({ rpcResult = null, rpcError, rows = [], readError } = {}) {
  let reads = 0
  const calls = []
  const predicates = []
  let limit = Infinity
  const query = {
    select() { return this },
    match(values) { for (const [key, value] of Object.entries(values)) this.eq(key, value); return this },
    eq(key, value) { predicates.push(row => row[key] === value); return this },
    contains(key, values) { predicates.push(row => Array.isArray(row[key]) && values.every(value => row[key].includes(value))); return this },
    or(filter) {
      const [, key, operation, value] = filter.match(/^(\w+)\.is\.null,\w+\.(lte|gte)\.(.+)$/)
      predicates.push(row => row[key] == null || (operation === 'lte' ? row[key] <= value : row[key] >= value))
      return this
    },
    limit(value) { limit = value; return this },
    abortSignal() { return Promise.resolve({ data: rows.filter(row => predicates.every(predicate => predicate(row))).slice(0, limit), error: readError }) },
  }
  const mockData = {
    scope,
    object(value) { return Array.isArray(value) ? value[0] || {} : value && typeof value === 'object' ? value : {} },
    text: value => typeof value === 'string' ? value : '',
    async rpc(name, args) { calls.push({ name, args }); if (rpcError) throw rpcError; return rpcResult },
    db: () => ({ from(table) { assert.equal(table, 'agent_prompts'); reads++; return query } }),
  }
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', source)(id => {
    if (id === './data') return mockData
    if (['server-only', './media-download', './media-format'].includes(id)) return {}
    throw new Error('Unexpected dependency: ' + id)
  }, compiled, compiled.exports)
  return { activePrompt: compiled.exports.activePrompt, calls, reads: () => reads }
}

test('uses the RPC-selected prompt without a secondary lookup', async () => {
  const h = harness({ rpcResult: { content: 'Primary active prompt' }, rows: [prompt()] })
  assert.equal(await h.activePrompt('respuesta_comercial'), 'Primary active prompt')
  assert.equal(h.reads(), 0)
  assert.deepEqual(h.calls[0], { name: 'get_active_prompt', args: { p_tenant_id: scope.tenant_id, p_project_id: scope.project_id,
    p_name: 'respuesta_comercial', p_channel: 'whatsapp', p_at: today } })
})

test('empty phase lookup can use the unique active project prompt regardless of its historical mode', async () => {
  for (const rpcResult of [null, [], { content: '   ' }]) {
    const h = harness({ rpcResult, rows: [prompt({ mode: 'lanzamiento' })] })
    assert.equal(await h.activePrompt('respuesta_comercial'), prompt().content)
    assert.equal(h.reads(), 1)
  }
})

test('fallback respects tenant, project, name, activation, channel and validity dates', async () => {
  const rejected = [
    prompt({ tenant_id: 'different-tenant' }), prompt({ project_id: 'different-project' }),
    prompt({ name: 'otro_prompt' }), prompt({ is_active: false }), prompt({ channel: ['instagram'] }),
    prompt({ channel: [] }), prompt({ valid_from: '9999-01-01' }), prompt({ valid_until: '2000-01-01' }),
  ]
  const h = harness({ rows: [...rejected, prompt({ valid_from: today, valid_until: today })] })
  assert.equal(await h.activePrompt('respuesta_comercial'), prompt().content)
  const noMatch = harness({ rows: rejected })
  await assert.rejects(noMatch.activePrompt('respuesta_comercial'), /PROMPT_MISSING_respuesta_comercial/)
})

test('lookup errors are not disguised as absent prompts or bypassed with stale content', async () => {
  const failure = new Error('RPC_get_active_prompt_FAILED')
  const h = harness({ rpcError: failure, rows: [prompt()] })
  await assert.rejects(h.activePrompt('respuesta_comercial'), error => error === failure)
  assert.equal(h.reads(), 0)
  const dbFailure = harness({ rows: [prompt()], readError: { message: 'database unavailable' } })
  await assert.rejects(dbFailure.activePrompt('respuesta_comercial'), /PROMPT_LOOKUP_FAILED_respuesta_comercial/)
})

test('multiple eligible prompts and blank content fail instead of picking arbitrary instructions', async () => {
  const duplicate = harness({ rows: [prompt(), prompt({ mode: 'preventa', content: 'Conflicting instructions' })] })
  await assert.rejects(duplicate.activePrompt('respuesta_comercial'), /PROMPT_AMBIGUOUS_respuesta_comercial/)
  const blank = harness({ rows: [prompt({ content: '  ' })] })
  await assert.rejects(blank.activePrompt('respuesta_comercial'), /PROMPT_MISSING_respuesta_comercial/)
})
