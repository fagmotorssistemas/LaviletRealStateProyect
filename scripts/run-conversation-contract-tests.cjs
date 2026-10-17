/* eslint-disable @typescript-eslint/no-require-imports -- Offline Node test runner. */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const destination = path.join(root, 'tmp', 'conversation-contract-validation')
const files = [
  'src/lib/integrations/automation/courtesy-continuation.test.ts',
  'src/lib/integrations/automation/writer-context-continuity.test.ts',
  'src/lib/integrations/automation/batched-flow-continuity.test.ts',
  'src/lib/integrations/automation/conversation-stability.test.ts',
  'src/lib/integrations/automation/material-and-commercial-continuity.test.ts',
  'src/lib/integrations/automation/ai-model-routing.test.ts',
  'src/lib/integrations/automation/typed-conversation-boundary.test.ts',
  'src/lib/integrations/automation/preparation-contract-boundary.test.ts',
  'src/lib/integrations/automation/extractor-confidence-pipeline.test.ts',
  'src/lib/integrations/automation/opening-discovery-pipeline.test.ts',
  'scripts/turn-interpretation.test.cjs',
  'src/lib/integrations/automation/turn-communication.test.ts',
  'src/lib/integrations/automation/visit-preference-contract.test.ts',
  'src/lib/integrations/automation/visit-intake-continuity.test.ts',
  'src/lib/integrations/automation/visit-intake-plan.test.ts',
  'src/lib/integrations/automation/visit-intake.test.ts',
  'src/lib/integrations/automation/visit-dialogue.test.ts',
  'src/lib/integrations/automation/selected-property-operation-continuity.test.ts',
  'src/lib/integrations/automation/canonical-planning-continuity.test.ts',
  'src/lib/integrations/automation/financing-consent-evidence.test.ts',
  'src/lib/integrations/automation/financing-invitation-receipt.test.ts',
  'src/lib/integrations/automation/reservation-invitation-receipt.test.ts',
  'src/lib/integrations/automation/greeting-preparation.test.ts',
  'src/lib/integrations/automation/reservation-continuity-pipeline.test.ts',
  'src/lib/integrations/automation/interpretation-neutral.test.ts',
  'src/lib/integrations/automation/provider-schema-contract.test.ts',
  'src/lib/integrations/automation/writer-authority.test.ts',
  'src/lib/integrations/automation/writer-content-review.test.ts',
  'src/lib/integrations/automation/response-review-policy.test.ts',
  'src/lib/integrations/automation/mandatory-server-guards.test.ts',
  'src/lib/integrations/automation/catalog-embeddings.test.ts',
  'src/lib/integrations/automation/catalog-result.test.ts',
  'scripts/visit-intake-continuity.pglite.test.cjs',
  'scripts/reservation-assignment.pglite.test.cjs',
]
const environment = { ...process.env }
for (const key of Object.keys(environment)) if (/(?:KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|SUPABASE_URL)/i.test(key)) delete environment[key]
fs.mkdirSync(destination, { recursive: true })
const preloads = ['--require', './scripts/fixtures/automation-audit-offline.cjs', '--require', './scripts/test-typescript.cjs']
const groups = [
  { name: 'contracts', args: ['--test', '--test-concurrency=4', ...files] },
  { name: 'runtime', args: ['--test', '--test-name-pattern=typed runtime|actual Wednesday|evidenced date answer|acknowledging the submitted|family alternatives recover early budget', 'scripts/integrations.test.cjs'] },
]
const startedAt = new Date().toISOString()
const results = groups.map(group => {
  const run = spawnSync(process.execPath, [...preloads, ...group.args], { cwd: root, env: environment, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, timeout: 180_000 })
  const tap = (run.stdout || '') + (run.stderr || '')
  fs.writeFileSync(path.join(destination, group.name + '.tap'), tap)
  const count = name => Number([...tap.matchAll(new RegExp('^# ' + name + ' (\\d+)$', 'gm'))].at(-1)?.[1] || 0)
  return { name: group.name, exitCode: run.status ?? 1, tests: count('tests'), passed: count('pass'), failed: count('fail'),
    ...(run.error ? { runnerError: run.error.code } : {}) }
})
const report = { startedAt, finishedAt: new Date().toISOString(), files, runtimePattern: groups[1].args[1], results,
  tests: results.reduce((n, result) => n + result.tests, 0), passed: results.reduce((n, result) => n + result.passed, 0),
  failed: results.reduce((n, result) => n + result.failed, 0), network: 'blocked', realModels: false, realMessages: false,
  scope: 'Current typed contract and selected real-handler regressions. The full historical audit remains a separate command.' }
fs.writeFileSync(path.join(destination, 'result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, files: undefined }, null, 2))
process.exitCode = results.every(result => result.exitCode === 0) ? 0 : 1
