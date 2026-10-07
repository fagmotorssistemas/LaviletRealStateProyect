/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const fixtures = require('./fixtures/extractor-model-evals.cjs')
const root = path.resolve(__dirname, '..')
function run(args) {
  const directory = fs.mkdtempSync(path.join(root, 'tmp', 'extractor-cli-'))
  const output = path.join(directory, 'result.json')
  const processResult = spawnSync(process.execPath, ['scripts/evaluate-extractor-model.cjs', ...args, '--out', output],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.equal(processResult.error, undefined)
  return { processResult, data: JSON.parse(fs.readFileSync(output, 'utf8')) }
}
test('default evaluation captures all scenarios without API calls and requires a terminal completion marker', () => {
  const { processResult, data } = run(['--models', 'gpt-4.1-mini'])
  assert.equal(processResult.status, 0)
  assert.equal(data.completed, true)
  assert.equal(data.planned_runs, fixtures.cases.length)
  assert.equal(data.runs.length, fixtures.cases.length)
  assert.ok(data.runs.every(run => run.status === 'dry_run' && run.calls.length === 0))
  assert.equal(data.calls, 0)
  assert.equal(data.estimated_usd_from_api_usage, 0)
  assert.equal(data.stopped_reason, null)
  assert.ok(data.source_snapshot['supabase/prompts/extractor-eventos.md'])
})
test('invalid evaluation options fail explicitly and cannot be reported as a completed paid test', () => {
  const { processResult, data } = run(['--models', 'unapproved-model'])
  assert.equal(processResult.status, 1)
  assert.equal(data.completed, false)
  assert.equal(data.calls, 0)
  assert.equal(data.stopped_reason, 'INVALID_EVALUATION_OPTIONS')
})
