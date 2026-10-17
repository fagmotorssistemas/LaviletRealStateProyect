// Synthetic trace only. No credentials, model requests or customer messages.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { webpack } = require('next/dist/compiled/webpack/webpack')
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-context-'))
const out = path.join(root, 'tmp', 'workflow-review-2026-10-17')
const decision = { contrato_redaccion: { objetivo_siguiente: { question_id: 'property_floor', instruction: 'Usar únicamente las opciones del conjunto.\nConservar preferencias.' } },
  contexto_verificado: { siguiente_paso_comercial: { action: 'select_property', selection_scope: { unit_ids: ['304', '404', '504'] } } } }
const data = { ...decision, contexto_verificado: { ...decision.contexto_verificado, lead: { name: 'Visible' },
  perfil_lead: { full_name: 'Carlos', declared_location: { kind: 'former', country: 'Ecuador' } }, ficha_comercial: null },
  estado_operativo: { profile_introduction: { stage: 'reminder' } } }
const repair = { fields: ['primary_intent', 'primary_evidence', 'confidence'], issues: ['non_current_evidence:primary_intent'], preserve_other_fields: true }
const step = (order, key, input = {}) => ({ order, key, input, output: {}, category: 'decision', label: key, status: 'succeeded', source: 'fixture', durationMs: 1, startedAt: '', completedAt: '', errorCode: null })
const executions = [{ id: 'trace', leadGroupId: 'synthetic', conversationId: 'synthetic', workflowId: 'overview', kind: 'message',
  path: [], status: 'completed', action: 'accepted', outcome: 'Kommo aceptó el envío', occurredAt: '2026-10-17T16:00:00Z', receivedAt: '2026-10-17T16:00:00Z',
  leadName: 'Prueba local', message: 'Mensaje que debe acompañar el desplazamiento.', traceAvailable: true, traceSource: 'recorded',
  steps: [step(1, 'message_received'), ...Array.from({ length: 22 }, (_, i) => step(i + 2, 'context_prepared')),
    step(24, 'model_request', { ai_role: 'extractor', prompt_snapshot: { data: { recuperacion_interpretacion: repair } } }),
    step(25, 'model_request', { ai_role: 'writer', prompt_snapshot: { capture_version: 2, data, limited: false, privacy_filtered: false } })] }]

async function main() {
  fs.mkdirSync(out, { recursive: true })
  const loader = path.join(dir, 'ts-loader.cjs'), cssLoader = path.join(dir, 'css-loader.cjs'), entry = path.join(dir, 'entry.tsx')
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
  fs.writeFileSync(cssLoader, `module.exports=function(source){const classes={};if(this.resourcePath.endsWith('.module.css')){const prefix=require('node:path').basename(this.resourcePath).replace(/\\W/g,'_');source=source.replace(/\\.([A-Za-z_][\\w-]*)/g,(_,name)=>'.'+(classes[name]=prefix+'_'+name))}return 'const style=document.createElement("style");style.textContent='+JSON.stringify(source)+';document.head.appendChild(style);export default '+JSON.stringify(classes)}`)
  fs.writeFileSync(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{MessageTraceView}from'${path.join(root, 'src/components/inmobiliaria/automation/workflow/MessageTraceView').replace(/\\/g, '/')}';createRoot(document.getElementById('root')).render(<MessageTraceView/>);`)
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry, output: { path: dir, filename: 'bundle.js' },
    plugins: [new webpack.ProvidePlugin({ process: require.resolve('next/dist/build/polyfills/process') })],
    resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules')], alias: { '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }, { test: /\.css$/, use: cssLoader }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : resolve()))
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ executions, nextCursor: null })); return }
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(dir, 'bundle.js'))); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font-family:Arial;margin:16px}button,input,select{font:inherit}</style><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) })
    for (const width of [1440, 768, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.address().port}`) ? route.continue() : route.abort())
      let reads = 0
      await page.route('**/api/**', route => {
        reads++
        const newer = { ...executions[0], id: 'newer', message: 'Otro mensaje recién recibido.', occurredAt: '2026-10-17T17:00:00Z', receivedAt: '2026-10-17T17:00:00Z' }
        return route.fulfill({ json: { executions: reads > 1 ? [newer, ...executions] : executions, nextCursor: null } })
      })
      const refreshed = page.waitForResponse(response => response.url().includes('/api/') && reads > 1)
      await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => {
        if (window.rejectCopy) throw Error('Denied'); window.copiedJson = text
      } } }))
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      const steps = page.getByRole('list', { name: 'Pasos observados de este mensaje' })
      await steps.getByRole('button').last().click()
      const inspector = page.getByLabel('Contexto exacto del redactor', { exact: true })
      await inspector.getByText('JSON del siguiente paso y reglas', { exact: true }).click()
      await inspector.getByRole('button', { name: 'Copiar JSON del siguiente paso y reglas', exact: true }).click()
      assert.deepEqual(JSON.parse(await page.evaluate(() => window.copiedJson)), decision)
      await inspector.getByText('JSON de la ficha y memoria del lead', { exact: true }).click()
      await inspector.getByRole('button', { name: 'Copiar JSON de la ficha y memoria del lead', exact: true }).click()
      assert.equal(JSON.parse(await page.evaluate(() => window.copiedJson)).contexto_verificado.ficha_comercial, null)
      await page.evaluate(() => { window.rejectCopy = true })
      await inspector.getByRole('button', { name: 'Copiar JSON del siguiente paso y reglas', exact: true }).click()
      assert.deepEqual(JSON.parse(await inspector.getByRole('textbox', { name: 'JSON del siguiente paso y reglas para copiar' }).inputValue()), decision)
      const dock = page.getByRole('region', { name: 'Mensaje analizado', exact: true })
      await page.evaluate(() => window.scrollBy(0, 350))
      await refreshed
      assert.match(await dock.innerText(), /Mensaje que debe acompañar el desplazamiento/)
      assert.doesNotMatch(await dock.innerText(), /Otro mensaje recién recibido/)
      assert.equal(await inspector.getByLabel('JSON del siguiente paso y reglas', { exact: true }).isVisible(), true)
      const bounds = await dock.boundingBox()
      assert.ok(bounds.y >= 0 && bounds.y < 30, `Message should remain visible at ${width}: ${JSON.stringify(bounds)}`)
      await page.screenshot({ path: path.join(out, `workflow-context-${width}.png`), fullPage: false })
      await steps.getByRole('button').nth(23).click()
      await page.getByText('JSON del motivo y los campos por corregir', { exact: true }).click()
      assert.match(await page.getByLabel('Motivo de la nueva extracción').innerText(), /non_current_evidence:primary_intent/)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `Horizontal overflow at ${width}`)
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log('Workflow context browser checks passed at 1440, 768 and 390px: exact JSON, clipboard fallback, repair reason and sticky message.')
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
