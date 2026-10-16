/* eslint-disable @typescript-eslint/no-require-imports -- Repository Node test runner. */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync, execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const files = require('./fixtures/automation-audit-test-files.json')
const destination = path.join(root, 'tmp', 'audit-corrections')
fs.mkdirSync(destination, { recursive: true })
const env = { ...process.env }
for (const key of Object.keys(env)) if (/(?:KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|SUPABASE_URL)/i.test(key)) delete env[key]
const startedAt = new Date().toISOString()
const result = spawnSync(process.execPath, [
  '--require', './scripts/fixtures/automation-audit-offline.cjs',
  '--require', './scripts/test-typescript.cjs', '--test', '--test-concurrency=4', ...files,
], { cwd: root, env, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 300_000 })
const tap = (result.stdout || '') + (result.stderr || '')
fs.writeFileSync(path.join(destination, 'results.tap'), tap)
const count = name => Number([...tap.matchAll(new RegExp('^# ' + name + ' (\\d+)$', 'gm'))].at(-1)?.[1] || 0)
const report = {
  startedAt, finishedAt: new Date().toISOString(), baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: 'local_uncommitted_changes', fileCount: files.length, files,
  exitCode: result.status ?? 1, tests: count('tests'), passed: count('pass'), failed: count('fail'),
  cancelled: count('cancelled'), skipped: count('skipped'), network: 'blocked', credentials: 'removed_from_environment',
  realModelCalls: false, realMessages: false, ...(result.error ? { runnerError: result.error.code || 'RUNNER_FAILED' } : {}),
}
fs.writeFileSync(path.join(destination, 'result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, files: undefined }, null, 2))
if (result.status !== 0) console.log(tap.split('\n').filter(line => line.startsWith('not ok')).join('\n'))
process.exitCode = report.exitCode
