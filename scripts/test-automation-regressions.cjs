/* eslint-disable @typescript-eslint/no-require-imports */
// One run per test file, even when it belongs to several regression suites.
const { spawnSync } = require('node:child_process')
const { scripts } = require('../package.json')
const suites = ['selection-intake', 'catalog-overview', 'commercial-journey', 'financing-identity',
  'conversation-continuation', 'financing-flow', 'catalog-retrieval', 'budget-financing-recovery',
  'prompts', 'turn-recovery', 'review-contracts', 'progressive-options', 'lead-introduction',
  'automation', 'conversation', 'test-contacts', 'cost-latency', 'message-trace', 'visit-inbox',
  'financing', 'tour-identity', 'integrations', 'prompt-compaction', 'reservation-commercial']
const files = [...new Set(suites.flatMap(suite => scripts[`test:${suite}`].split(/\s+/)
  .filter(file => /\.test\.(?:ts|cjs)$/.test(file))))].sort()
console.log(`Regression suites: ${suites.length}; distinct files: ${files.length}`)
const result = spawnSync(process.execPath, ['--require', './scripts/test-typescript.cjs', '--test', ...files],
  { stdio: 'inherit', env: process.env })
process.exitCode = result.status ?? 1
