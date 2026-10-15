/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated monitor UI: synthetic audits, no credentials or model calls.
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs/promises'), nativeFs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const esbuild = require('esbuild'), { chromium } = require('playwright')
const root = path.join(__dirname, '..')
const installedBrowser = [process.env.PLAYWRIGHT_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => candidate && nativeFs.existsSync(candidate))
const step = (output, key = 'response_coverage') => ({ order: 1, key, output, input: {}, label: key, category: 'decision', status: 'succeeded', source: 'fixture', startedAt: '', completedAt: '', durationMs: 0, errorCode: null })
const execution = (id, message, output, key) => ({ id, leadGroupId: 'synthetic', workflowId: 'overview', path: [], status: 'completed', action: 'accepted', outcome: 'Kommo aceptó el envío', occurredAt: `2026-10-12T15:0${id}:00Z`, leadName: 'Lead de prueba', message, traceAvailable: true, steps: [step(output, key)] })
const executions = [
  execution('4', 'Borrador rechazado: consulta de precio', { status: 'rejected_review', draft_rejected: true }),
  execution('3', 'Borrador corregido: consulta de unidad', { status: 'checked', repair_attempts: [{ target: 'commercial_draft', status: 'rejected_guard' }] }),
  execution('2', 'Rechazo observado: modo demostración', { status: 'review_observed', review_control: { observationOnly: true, source: 'project_setting' },
    observation: { status: 'rejected_guard' }, semantic_review: { status: 'checked', acceptance: { content_approved: true } },
    final_validation: { passed: false, issues: ['commercial_next_question_mismatch'] } }),
  execution('1', 'Error del extractor: tres dormitorios', { status: 'invalid', issues: ['non_current_evidence:turn_semantics.budget.evidence'] }, 'semantic_extraction'),
]

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavilet-message-review-ui-'))
  await esbuild.build({ stdin: { contents: "import React from 'react'; import {createRoot} from 'react-dom/client'; import {MessageTraceView} from './src/components/inmobiliaria/automation/workflow/MessageTraceView'; createRoot(document.getElementById('app')).render(<MessageTraceView/>);", resolveDir: root, loader: 'tsx' },
    bundle: true, outfile: path.join(dir, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [{ name: 'isolated-message-review-ui', setup(build) {
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'local-link' }))
      build.onLoad({ filter: /.*/, namespace: 'local-link' }, () => ({ resolveDir: root, loader: 'tsx', contents: "import React from 'react';export default function Link(props){return <a {...props}/>;}" }))
      build.onResolve({ filter: /^@\// }, args => ({ path: [path.join(root, 'src', args.path.slice(2)), path.join(root, 'src', args.path.slice(2)) + '.ts', path.join(root, 'src', args.path.slice(2)) + '.tsx'].find(candidate => nativeFs.existsSync(candidate)) }))
    } }] })
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/integrations/automation/workflow')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ executions, nextCursor: null })); return }
      if (req.url.startsWith('/app.js') || req.url.startsWith('/app.css')) { const name = req.url.startsWith('/app.js') ? 'app.js' : 'app.css'; res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(dir, name))); return }
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revisión de mensajes aislada</title><link rel="stylesheet" href="/app.css"><style>body{font-family:Arial;margin:16px;background:#f7f9f4}*{box-sizing:border-box}</style><div id="app"></div><script src="/app.js"></script></html>')
    } catch { res.statusCode = 500; res.end('fixture unavailable') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { dir, server, url: 'http://127.0.0.1:' + server.address().port }
}

test('review colours, explicit labels and selected borders survive on desktop and mobile', { timeout: 45000 }, async () => {
  const f = await fixture(); let browser
  try {
    browser = await chromium.launch({ headless: true, ...(installedBrowser ? { executablePath: installedBrowser } : {}) })
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.request().url().startsWith(f.url) ? route.continue() : route.abort())
      await page.goto(f.url)
      const messages = page.getByRole('navigation', { name: 'Mensajes de la conversación' })
      await messages.getByText('Rojo: revisión sin aprobar', { exact: true }).waitFor()
      assert.equal(await messages.locator('button[data-review-tone="rejected"]').count(), 1)
      assert.equal(await messages.locator('button[data-review-tone="warning"]').count(), 2)
      const rejected = messages.getByRole('button').filter({ hasText: 'Borrador rechazado: consulta de precio' })
      assert.equal(await rejected.getAttribute('aria-pressed'), 'true')
      assert.equal(await rejected.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 244, 244)')
      assert.match(await rejected.evaluate(node => getComputedStyle(node).boxShadow), /inset/)
      const corrected = messages.getByRole('button').filter({ hasText: 'Borrador corregido: consulta de unidad' })
      await corrected.click()
      await page.mouse.move(0, 0)
      assert.equal(await corrected.getAttribute('aria-pressed'), 'true')
      assert.equal(await corrected.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 248, 236)')
      await messages.getByRole('button').filter({ hasText: 'Rechazo observado: modo demostración' }).click()
      const owners = page.getByLabel('Responsables de la revisión')
      await owners.getByText('IA revisora: aprobó el contenido factual y las promesas comerciales.').waitFor()
      assert.match(await owners.innerText(), /commercial_next_question_mismatch/)
      assert.match(await owners.innerText(), /no fue un rechazo de la IA revisora/)
      await owners.scrollIntoViewIfNeeded()
      const extraction = messages.getByRole('button').filter({ hasText: 'Error del extractor' })
      assert.equal(await extraction.getAttribute('data-review-tone'), null)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await page.screenshot({ path: path.join(f.dir, mobile ? 'mobile-review-markers.png' : 'desktop-review-markers.png') })
      assert.deepEqual(errors, [])
      await context.close()
    }
    console.log('Review message screenshots: ' + f.dir)
  } finally { await browser?.close(); await new Promise(resolve => f.server.close(resolve)) }
})
