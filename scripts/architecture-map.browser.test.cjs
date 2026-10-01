// Isolated UI test: synthetic executions, no credentials, model calls or outbound messages.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { webpack } = require('next/dist/compiled/webpack/webpack')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-map-'))
const step = (order, key, output = {}, input = {}) => ({ order, key, output, input, category: 'decision', label: key, status: 'succeeded', source: 'fixture', durationMs: 20, startedAt: '', completedAt: '', errorCode: null })
const execution = (id, message, steps) => ({ id, leadGroupId: 'lead-1', conversationId: 'conversation-1', workflowId: 'overview', kind: 'message', path: [], status: 'completed', action: 'accepted', outcome: 'Kommo aceptó el envío', occurredAt: `2026-10-01T1${id}:00:00Z`, receivedAt: `2026-10-01T1${id}:00:00Z`, leadName: 'Lead de prueba', message, traceAvailable: true, traceSource: 'recorded', steps })
const executions = [execution('2', '¿Qué precio tiene el departamento?', [
  step(1, 'message_received'), step(2, 'turn_intent', { objective: 'ask_price', needs_reference: false }),
  step(3, 'response_coverage', { status: 'checked' }),
  step(4, 'model_request', { output_snapshot: { data: { reply: 'Primer borrador conservado' } } }, { ai_role: 'writer', caused_by_step: 3,
    prompt_snapshot: { capture_version: 2, instructions: '# Rol\n\n  - Responder con datos exactos', user_prefix: 'Datos:\n', data: { message: 'Consulta' }, response_schema: null, request_parameters: { model: 'synthetic', max_output_tokens: 2000 } } }),
  step(5, 'model_request', {}, { ai_role: 'reviewer', caused_by_step: 3 }),
  step(6, 'model_request', { output_snapshot: { data: { reply: 'Segundo borrador conservado' } } }, { ai_role: 'writer', caused_by_step: 3,
    prompt_snapshot: { instructions: 'Registro anterior', data: {} } }),
]), execution('1', 'Tengo un presupuesto de 50 mil dólares', [step(1, 'turn_intent', { objective: 'discuss_budget' }), step(2, 'budget_resolution', { status: 'incomplete_prices', price_evidence_complete: false }, { amount: 50000, currency: 'USD' })]),
execution('3', 'Diagnóstico de ficha del revisor', [
  step(1, 'response_coverage', { status: 'rejected_review', recovery: { pending: true }, repair_attempts: [{ issues: [{ code: 'numeric_binding_not_in_sentence', binding: { key: 'factual_values', index: 0 }, numeric_id: 'N4', sentence_id: 'S3', received: 24, owner: 'system', repair_owner: 'reviewer' }] }] }),
  step(2, 'model_request', { output_snapshot: { data: { factual_values: [], project_values: [], claims: [{ verdict: 'supported', fragment: 'S3', evidence_ids: ['E9'] }], numeric_checks: [{ numeric_id: 'N4', factual_value_indexes: [0], project_value_indexes: [] }] } } },
    { ai_role: 'reviewer', caused_by_step: 1, prompt_snapshot: { data: { oraciones_borrador: [{ id: 'S3', text: 'Seguridad 24h.' }], evidencia_afirmaciones: [{ id: 'E9', path: 'instalaciones.6', value: 'Seguridad 24h.' }], referencias_numericas: [{ id: 'N4', sentence_id: 'S3', text: '24', value: 24 }] } } }),
])]

async function main() {
  const loader = path.join(dir, 'ts-loader.cjs'), cssLoader = path.join(dir, 'css-loader.cjs'), entry = path.join(dir, 'entry.tsx')
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
  fs.writeFileSync(cssLoader, `module.exports=function(source){const classes={};if(this.resourcePath.endsWith('.module.css')){const prefix=require('node:path').basename(this.resourcePath).replace(/\\W/g,'_');source=source.replace(/\\.([A-Za-z_][\\w-]*)/g,(_,name)=>'.'+(classes[name]=prefix+'_'+name))}return 'const style=document.createElement("style");style.textContent='+JSON.stringify(source)+';document.head.appendChild(style);export default '+JSON.stringify(classes)}`)
  fs.writeFileSync(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{MessageTraceView}from'${path.join(root, 'src/components/inmobiliaria/automation/workflow/MessageTraceView').replace(/\\/g, '/')}';createRoot(document.getElementById('root')).render(<MessageTraceView architecture/>);`)
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry, output: { path: dir, filename: 'bundle.js' },
    plugins: [new webpack.ProvidePlugin({ process: require.resolve('next/dist/build/polyfills/process') })],
    resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules')], alias: { '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }, { test: /\.css$/, use: cssLoader }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : resolve()))
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ executions, nextCursor: null })); return }
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(dir, 'bundle.js'))); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font-family:Arial;margin:16px}button,input,select{font:inherit}</style><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) })
    for (const width of [1440, 768, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = []
      page.on('pageerror', e => { errors.push(e.message); console.error('BROWSER_ERROR', e.message) })
      await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.address().port}`) ? route.continue() : route.abort())
      await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => {
        if (window.rejectCopy) throw new Error('Clipboard denied')
        window.copiedPrompt = text
      } } }))
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      const selector = page.getByLabel('Mensaje del mapa', { exact: true })
      try { await selector.waitFor({ timeout: 10000 }) } catch (error) { console.error((await page.locator('body').innerText()).slice(0, 1600)); throw error }
      await selector.selectOption({ label: await selector.locator('option').filter({ hasText: '¿Qué precio' }).innerText() })
      await page.getByRole('button', { name: 'Objetivos', exact: true }).click()
      await page.locator('[data-id="intent_ask_price"]').click()
      await page.getByRole('complementary').getByText('objective = ask_price').waitFor()
      assert.equal(await page.locator('[data-id="intent_ask_price"] [data-state="observed"]').count(), 1)
      await page.getByRole('button', { name: 'Redacción y revisión', exact: true }).click()
      await page.locator('[data-id="writer"]').click()
      const inspector = page.getByRole('complementary')
      await inspector.getByText(/Paso 4/).click()
      await inspector.getByText(/Paso 6/).click()
      assert.match(await inspector.innerText(), /Primer borrador conservado/)
      assert.match(await inspector.innerText(), /Segundo borrador conservado/)
      await inspector.getByRole('button', { name: 'Copiar prompt completo', exact: true }).click()
      const copied = JSON.parse(await page.evaluate(() => window.copiedPrompt))
      assert.equal(copied.capture.exact, true)
      assert.equal(copied.request.instructions, '# Rol\n\n  - Responder con datos exactos')
      assert.equal(copied.request.model, 'synthetic')
      await inspector.getByRole('button', { name: 'Copiar captura del prompt', exact: true }).click()
      assert.equal(JSON.parse(await page.evaluate(() => window.copiedPrompt)).capture.exact, false)
      await page.evaluate(() => { window.rejectCopy = true })
      await inspector.getByRole('button', { name: 'Copiar prompt completo', exact: true }).click()
      const manual = inspector.getByRole('textbox', { name: 'Prompt para copiar manualmente' })
      assert.equal(JSON.parse(await manual.inputValue()).request.instructions, copied.request.instructions)
      await selector.selectOption({ label: await selector.locator('option').filter({ hasText: 'Tengo un presupuesto' }).innerText() })
      await page.getByRole('button', { name: 'Presupuesto', exact: true }).click()
      await page.locator('[data-id="budget_incomplete_prices"]').click()
      await inspector.getByText('status = incomplete_prices').waitFor()
      assert.equal(await page.locator('[data-id="intent_ask_price"] [data-state="not_selected"]').count(), 1)
      await selector.selectOption({ label: await selector.locator('option').filter({ hasText: 'Diagnóstico de ficha' }).innerText() })
      await page.getByRole('button', { name: 'Ir al primer error', exact: true }).click()
      assert.equal(await page.locator('[data-id="coverage"] [data-state="rejected"]').count(), 1)
      await inspector.getByText('Qué falló y en qué campo').waitFor()
      await page.getByRole('button', { name: 'Redacción y revisión', exact: true }).click()
      await page.locator('[data-id="reviewer"]').click()
      await inspector.locator('[data-invalid-field="output_snapshot.data.numeric_checks.0.factual_value_indexes.0"]').waitFor()
      await inspector.getByText('Qué significan E, S y N en esta llamada').click()
      await inspector.getByText('E9 · instalaciones.6').waitFor()
      await page.screenshot({ path: path.join(dir, `architecture-${width}.png`), fullPage: false })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `Horizontal overflow at ${width}`)
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log(`Architecture browser checks passed at 1440, 768 and 390px. Screenshots: ${dir}`)
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
