/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const readLog = file => {
  const data = fs.readFileSync(file)
  return data.toString(data[0] === 255 && data[1] === 254 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '')
}
const final = read('tmp/prompt-compaction/live-final.json')
const initial = read('tmp/prompt-compaction/live-evaluation.json')
const proposals = read('tmp/prompt-compaction/live-proposals-final.json')
const repetitions = read('tmp/prompt-compaction/live-recommendation-repeat.json')
const count = text => Object.fromEntries(['tests', 'pass', 'fail'].map(key => [key,
  Number(text.match(new RegExp(`^# ${key} (\\d+)`, 'm'))[1])]))
const failures = text => [...text.matchAll(/^not ok \d+ - (.*)$/gm)].map(m => ({
  test: m[1].trim(), location: text.slice(m.index).match(/location: '([^']+)'/)?.[1] || 'See log' })).sort((a, b) => a.test.localeCompare(b.test))
const currentLog = readLog('tmp/prompt-compaction/regressions-final.log')
const baselineLog = readLog('tmp/prompt-compaction/baseline-regressions.log')
const current = count(currentLog), baseline = count(baselineLog)
const sameFailures = JSON.stringify(failures(currentLog).map(f => f.test)) === JSON.stringify(failures(baselineLog).map(f => f.test))
if (!sameFailures) throw Error('NEW_REGRESSION_FAILURES')
const extractor = version => final.runs.filter(r => r.role === 'extractor' && r.version === version)
const sum = (rows, fn) => rows.reduce((total, row) => total + fn(row), 0)
const before = extractor('before'), after = extractor('after')
const percentage = (a, b) => a ? `${((b - a) / a * 100).toFixed(1)} %` : b ? 'Sin base' : '0.0 %'
const metric = (label, a, b, formatter = String) => ({ label, before: formatter(a), after: formatter(b), difference: percentage(a, b) })
const summary = {
  baseline_commit: final.baseline_commit,
  active_changes: ['Remove redundant JSON example in extractor instructions; preserve the semantic prose and strict schema.'],
  inactive_changes: [{ name: 'shared-turn-state-v1', reason: 'A live draft conflated category-area relationships. Lossless data expansion alone does not prove model quality.' }],
  production_models_changed: false, commercial_rules_changed: false, database_or_messages_modified: false,
  tests: { files: Number(currentLog.match(/distinct files: (\d+)/)[1]), total: current.tests, pass: current.pass, fail: current.fail,
    focused_total: 58, focused_pass: 58, new_tests: 45 },
  baseline: { total: baseline.tests, pass: baseline.pass, fail: baseline.fail, same_failures: sameFailures },
  outstanding_tests: failures(currentLog),
  live: { total_calls: initial.calls + final.calls + proposals.calls + repetitions.calls,
    extractor_valid_calls: before.length + after.length, extractor_pass: [...before, ...after].filter(r => r.status === 'pass').length,
    writer_candidate_valid_calls: 20, writer_candidate_automatic_mismatches: 1,
    manual_writer_observations: ['Area maximum conflated across apartment/penthouse categories.', 'Balcony was asserted from exterior-area-only evidence.'],
    usd: initial.estimated_usd_from_api_usage + final.estimated_usd_from_api_usage + proposals.estimated_usd_from_api_usage + repetitions.estimated_usd_from_api_usage,
    accounting: 'Calculated using API token usage and the application price snapshot; not an API invoice amount.',
    exclusions: 'Initial 42-call capture superseded; four additional calls used fixtures missing the active commercial journey and were corrected and repeated.' },
  checks: ['TypeScript aprobado', 'Build aprobado', 'Lint aprobado'],
  test_limitations: 'Las 46 pruebas que fallan ya fallaban con la revisión anterior: 42 en integrations.test.cjs, 3 en unit-alternatives.test.cjs y 1 en financing-review-action.test.cjs. Hay expectativas de texto y contratos de mocks antiguos (por ejemplo, validateReply), y diferencias de flujo que necesitan auditoría. No se cambiaron ni omitieron esas pruebas para obtener un resultado verde; no se afirma que sean 46 fallos de mensajes reales ni que todos sean simples fallos del test.',
  metrics: [
    metric('Caracteres de instrucciones', sum(before, r => r.size.instructions), sum(after, r => r.size.instructions)),
    metric('Caracteres de contexto', sum(before, r => r.size.context), sum(after, r => r.size.context)),
    metric('Caracteres de esquema', sum(before, r => r.size.schema), sum(after, r => r.size.schema)),
    metric('Tokens de entrada API', sum(before, r => r.usage.input_tokens), sum(after, r => r.usage.input_tokens)),
    metric('Entrada en caché API', sum(before, r => r.usage.cached_input_tokens), sum(after, r => r.usage.cached_input_tokens)),
    metric('Tokens de salida API', sum(before, r => r.usage.output_tokens), sum(after, r => r.usage.output_tokens)),
    metric('Costo calculado (USD)', sum(before, r => r.usd), sum(after, r => r.usd), n => n.toFixed(4)),
    metric('Duración media API (s)', sum(before, r => r.elapsed_ms) / before.length / 1000,
      sum(after, r => r.elapsed_ms) / after.length / 1000, n => n.toFixed(2)),
  ],
  evaluation_cases: final.runs.filter(r => r.role === 'extractor').map(r => ({ id: r.id, version: r.version,
    status: r.status, model: r.model, usage: r.usage, size: r.size, elapsed_ms: r.elapsed_ms, usd: r.usd })),
}
fs.mkdirSync('docs/automation', { recursive: true })
fs.writeFileSync('docs/automation/prompt-compaction-validation-2026-10-06.json', JSON.stringify(summary, null, 2))
fs.writeFileSync('tmp/prompt-compaction/report-evidence.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ tests: summary.tests, baseline: summary.baseline, live: summary.live, metrics: summary.metrics }, null, 2))
