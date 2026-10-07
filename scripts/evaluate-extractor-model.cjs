/* eslint-disable @typescript-eslint/no-require-imports */
// Only synthetic inference. No DB, CRM, WhatsApp or changes to runtime settings.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'), true, { info() {}, error() {} })
require('./test-typescript.cjs')
const { interpretConversationTurn } = require('../src/lib/integrations/automation/turn-interpretation.ts')
const { aiJson } = require('../src/lib/integrations/automation/ai.ts')
const { executionCost } = require('../src/components/inmobiliaria/automation/workflow/executionCost.ts')
const fixtures = require('./fixtures/extractor-model-evals.cjs')
const args = process.argv.slice(2), arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const live = args.includes('--live'), models = arg('--models', 'gpt-4.1,gpt-4.1-mini').split(',')
const maxCalls = Number(arg('--max-calls', '100')), maxUsd = Number(arg('--max-usd', '3')), repeat = Number(arg('--repeat', '1'))
const selected = arg('--case', '').split(',').filter(Boolean), output = arg('--out', 'tmp/extractor-model/evaluation.json')
const prompt = fs.readFileSync(path.resolve(__dirname, '../supabase/prompts/extractor-eventos.md'), 'utf8')
const runs = [], measurements = []
const startedAt = new Date().toISOString()
const sourceFiles = ['scripts/evaluate-extractor-model.cjs', 'scripts/fixtures/extractor-model-evals.cjs',
  'src/lib/integrations/automation/ai-model-routing.ts', 'src/lib/integrations/automation/turn-interpretation.ts',
  'src/lib/integrations/automation/turn-interpretation-input.ts', 'src/lib/integrations/automation/turn-semantics.ts',
  'src/lib/integrations/automation/interpretation-memory.ts', 'src/lib/integrations/automation/project-quantities.ts',
  'src/lib/integrations/automation/focused-numeric-syntax.ts', 'src/lib/integrations/automation/ai.ts',
  'src/lib/integrations/automation/turn-routing.ts',
  'src/components/inmobiliaria/automation/workflow/executionCost.ts', 'supabase/prompts/extractor-eventos.md']
const sourceSnapshot = Object.fromEntries(sourceFiles.map(file => [file,
  crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]))
const realFetch = global.fetch
let calls = 0, reserveUsd = 0, currentRun, fatal, completed = false, plannedRuns = 0
const cost = values => executionCost(values.map(m => ({ key: 'model_request', input: { model: m.model }, output: { token_usage: m.usage } }))).estimatedUsd
global.fetch = async (url, options) => {
  if (!live || String(url) !== 'https://api.openai.com/v1/responses' || options?.method !== 'POST') throw Error('EVALUATION_NETWORK_BOUNDARY')
  const body = JSON.parse(options.body)
  if (body.model !== currentRun.model) throw Error('EVALUATION_MODEL_MISMATCH')
  const size = { instructions: body.instructions.length, context: JSON.stringify(body.input).length, schema: JSON.stringify(body.text?.format?.schema).length }
  const ceiling = cost([{ model: body.model, usage: { input_tokens: Buffer.byteLength(options.body, 'utf8') + 1024, cached_input_tokens: 0, output_tokens: body.max_output_tokens } }])
  if (!Number.isFinite(ceiling) || calls >= maxCalls || cost(measurements) + reserveUsd + ceiling > maxUsd) { fatal = 'EVALUATION_BUDGET_LIMIT'; throw Error(fatal) }
  const hash = crypto.createHash('sha256').update(JSON.stringify({ ...body, model: undefined, prompt_cache_key: undefined })).digest('hex')
  currentRun.calls.push({ size, comparable_request_hash: hash })
  calls++; reserveUsd += ceiling
  const response = await realFetch(url, { ...options, redirect: 'error' })
  const result = await response.clone().json()
  if (result.usage) {
    const usage = { input_tokens: result.usage.input_tokens, cached_input_tokens: result.usage.input_tokens_details?.cached_tokens || 0,
      output_tokens: result.usage.output_tokens }
    measurements.push({ model: body.model, usage }); Object.assign(currentRun.calls.at(-1), { usage, usd: cost([{ model: body.model, usage }]), response_model: result.model })
    reserveUsd -= ceiling
  } else if (!response.ok) reserveUsd -= ceiling
  if (!response.ok && (response.status === 401 || response.status === 402 || response.status === 403 || /insufficient_quota|credit_balance_exhausted/i.test(result.error?.code || ''))) fatal = `OPENAI_HTTP_${response.status}_${result.error?.code || 'account_unavailable'}`
  return response
}
function save() {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify({ live, started_at: startedAt, recorded_at: new Date().toISOString(), source_snapshot: sourceSnapshot,
    prompt_source: 'repository extractor prompt with current production assembly and normalization',
    limitation: 'Synthetic cases, no live project prompt lookup or end-to-end delivery. Repeated trials do not prove universal quality.',
    completed, planned_runs: plannedRuns,
    limits: { maxCalls, maxUsd, repeat }, calls, estimated_usd_from_api_usage: cost(measurements), unresolved_reserve_usd: reserveUsd,
    stopped_reason: fatal || null, runs }, null, 2))
}
async function main() {
  if (!models.every(m => ['gpt-4.1', 'gpt-4.1-mini'].includes(m)) || !models.length || new Set(models).size !== models.length
    || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 150 || !Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 5
    || !Number.isInteger(repeat) || repeat < 1 || repeat > 3) throw Error('INVALID_EVALUATION_OPTIONS')
  if (live && !process.env.OPENAI_API_KEY) throw Error('OPENAI_NOT_CONFIGURED')
  const cases = fixtures.cases.filter(c => !selected.length || selected.includes(c.id))
  if (!cases.length || selected.some(id => !cases.some(c => c.id === id))) throw Error('UNKNOWN_CASE')
  plannedRuns = cases.length * models.length * repeat
  save()
  for (let iteration = 1; iteration <= repeat; iteration++) for (const [index, fixture] of cases.entries()) {
    for (const model of (index % 2 ? models : [...models].reverse())) {
      if (fatal) break
      const run = { id: fixture.id, iteration, model, calls: [] }; runs.push(run); currentRun = run
      const before = process.env.OPENAI_MODEL_EXTRACTOR, started = Date.now()
      let raw
      try {
        process.env.OPENAI_MODEL_EXTRACTOR = model
        const interpreted = await interpretConversationTurn({ mensaje_actual: fixture.message, alcance_negocio: 'property',
          catalogo_unidades: fixtures.units, ...JSON.parse(JSON.stringify(fixture.input || {})) }, {
          activePrompt: async () => prompt,
          aiJson: async (rules, input, schema) => {
            if (!live) { run.prompt_size = { instructions: rules.length, context: JSON.stringify(input).length, schema: JSON.stringify(schema).length }; throw Error('CAPTURE_ONLY') }
            const response = await aiJson(rules, input, schema)
            currentRun.calls.at(-1).raw = response
            // Focused recovery has a partial schema; it is not the original model's full interpretation.
            if (raw === undefined) raw = response
            return response
          },
        })
        run.raw_oracle_passed = fixture.check(raw)
        run.normalized_oracle_passed = fixture.check({ ...interpreted.extracted, turn_semantics: interpreted.semantics, requests: interpreted.requests })
        // Report model errors even when deterministic normalization safely repairs them.
        run.status = run.normalized_oracle_passed ? 'pass' : 'semantic_mismatch'
        run.raw = raw; run.normalized = { extracted: interpreted.extracted, semantics: interpreted.semantics, requests: interpreted.requests, diagnostic: interpreted.diagnostic }
      } catch (error) { run.status = !live && error.message === 'CAPTURE_ONLY' ? 'dry_run' : 'error'; run.error = run.status === 'dry_run' ? undefined : error.message; if (Array.isArray(error.issues)) run.issues = error.issues; if (raw) run.raw = raw }
      finally {
        if (before === undefined) delete process.env.OPENAI_MODEL_EXTRACTOR; else process.env.OPENAI_MODEL_EXTRACTOR = before
        run.elapsed_ms = Date.now() - started; save()
      }
      console.log(JSON.stringify({ id: run.id, model, status: run.status, calls, usd: cost(measurements), error: run.error }))
    }
    if (fatal) break
  }
  completed = !fatal && runs.length === plannedRuns && runs.every(run => run.status)
  if (!completed && !fatal) fatal = 'EVALUATION_INCOMPLETE'
  save()
  console.log(JSON.stringify({ completed, planned_runs: plannedRuns, calls, passed: runs.filter(r => r.status === 'pass').length,
    raw_mismatches: runs.filter(r => r.raw_oracle_passed === false).map(r => `${r.id}:${r.model}`),
    mismatches: runs.filter(r => r.status === 'semantic_mismatch').map(r => `${r.id}:${r.model}`),
    errors: runs.filter(r => r.status === 'error').map(r => `${r.id}:${r.error}`), usd: cost(measurements), stopped: fatal || null }))
  if (fatal || runs.some(r => ['error','semantic_mismatch'].includes(r.status))) process.exitCode = 1
}
// Keep asynchronous requests alive in the standalone CLI and never equate a
// partial checkpoint with a completed evaluation. This does not change production.
const keepAlive = setInterval(() => {}, 1000)
main().catch(error => { fatal = error.message; save(); console.error(error.message); process.exitCode = 1 })
  .finally(() => clearInterval(keepAlive))
process.on('beforeExit', () => {
  if (!completed && !fatal) { fatal = 'EVALUATION_INCOMPLETE'; save(); process.exitCode = 1 }
})
