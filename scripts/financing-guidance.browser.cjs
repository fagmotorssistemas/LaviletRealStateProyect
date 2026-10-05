/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated form: real component/validation, fake actions, no credentials or customer messages.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { webpack } = require('next/dist/compiled/webpack/webpack')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'financing-guidance-'))
async function main() {
  const loader = path.join(dir, 'ts-loader.cjs'), css = path.join(dir, 'css-loader.cjs')
  const actions = path.join(dir, 'actions.ts'), header = path.join(dir, 'header.tsx'), entry = path.join(dir, 'entry.tsx')
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
  fs.writeFileSync(css, `module.exports=s=>{const c={};s=s.replace(/\\.([A-Za-z_][\\w-]*)/g,(_,n)=>'.'+(c[n]=n));return 'const s=document.createElement("style");s.textContent='+JSON.stringify(s)+';document.head.appendChild(s);export default '+JSON.stringify(c)}`)
  fs.writeFileSync(header, `import React from 'react';export const automationSettingsStyles={shell:'shell'};export function AutomationSettingsHeader(p){return <header><h1>{p.title}</h1><p>{p.description}</p></header>}`)
  fs.writeFileSync(actions, `import{defaultFinancingGuidance,validateFinancingGuidance}from'@/lib/inmobiliaria/financingGuidance';let state={settings:defaultFinancingGuidance(),version:'v1',saved:false};export async function loadFinancingGuidance(){return {ok:true,state:structuredClone(state)}};export async function saveFinancingGuidance(input,version){if(window.rejectNextSave){window.rejectNextSave=false;return {ok:false,error:'La configuración cambió. Actualice antes de guardar.'}}try{if(version!==state.version)throw Error('Configuración desactualizada');state={settings:validateFinancingGuidance(input),version:state.version+'1',saved:true};window.financingSaved=structuredClone(state);return{ok:true,state:structuredClone(state)}}catch(e){return{ok:false,error:e.message}}}`)
  fs.writeFileSync(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{FinancingGuidanceSettings}from'@/components/inmobiliaria/automation/FinancingGuidanceSettings';import{loadFinancingGuidance}from'@/app/inmobiliaria/automatizacion/financiamiento/actions';loadFinancingGuidance().then(initial=>createRoot(document.getElementById('root')).render(<FinancingGuidanceSettings initial={initial}/>));`)
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry, output: { path: dir, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules')], alias: {
      '@/app/inmobiliaria/automatizacion/financiamiento/actions$': actions, '@': path.join(root, 'src') } },
    plugins: [new webpack.NormalModuleReplacementPlugin(/^\.\/AutomationSettings$/, header)],
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }, { test: /\.css$/, use: css }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : resolve()))
  const server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(dir, 'bundle.js'))); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font-family:Arial;margin:18px;background:#fafaf7}.shell{max-width:1200px;margin:auto}button,input,select,textarea{font:inherit}</style><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined })
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = []
      page.on('pageerror', error => errors.push(error.message))
      const url = `http://127.0.0.1:${server.address().port}`
      await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort())
      await page.goto(url)
      await page.getByRole('heading', { name: 'Banco Pichincha', exact: true }).waitFor()
      const project = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Entrada exigida por el proyecto', exact: true }) })
      await project.getByLabel('Condición del proyecto').selectOption('required')
      await project.getByLabel('Entrada (%)', { exact: true }).fill('30')
      await project.getByLabel('Cuándo se paga').fill('Al firmar la promesa')
      await project.getByLabel('Unidades (vacío: todas las del tipo elegido)').pressSequentially('502, 601')
      await project.getByLabel('Fuente o documento autorizado').fill('Política aprobada por dirección')
      await project.getByLabel('Verificado el').fill('2026-10-05')
      const jep = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Cooperativa JEP', exact: true }) })
      await jep.getByLabel('Usar condiciones publicadas de esta entidad').uncheck()
      await page.getByRole('button', { name: 'Guardar condiciones', exact: true }).click()
      await page.getByRole('status').getByText(/Cambios guardados/).waitFor()
      const saved = await page.evaluate(() => window.financingSaved.settings)
      assert.deepEqual(saved.entry.unitNumbers, ['502', '601'])
      assert.equal(saved.entry.value, 30)
      assert.equal(saved.lenders[0].enabled, false)
      assert.equal(saved.lenders[1].enabled, true)
      await page.evaluate(() => { window.rejectNextSave = true })
      await page.getByRole('button', { name: 'Guardar condiciones', exact: true }).click()
      await page.getByRole('alert').getByText(/configuración cambió/).waitFor()
      await page.getByRole('button', { name: 'Actualizar configuración', exact: true }).click()
      await page.getByRole('status').getByText(/Configuración actualizada/).waitFor()
      await page.getByLabel('Activar condiciones de entrada, reserva y entidades').uncheck()
      await page.getByRole('button', { name: 'Guardar condiciones', exact: true }).click()
      await page.getByRole('status').getByText(/Cambios guardados/).waitFor()
      assert.equal(await page.evaluate(() => window.financingSaved.settings.enabled), false)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, `Overflow at ${width}px`)
      assert.deepEqual(errors, [])
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({ path: path.join(dir, `financing-${width}.png`), fullPage: false })
      await page.close()
    }
    console.log(`Financing form passed at desktop/mobile widths; editing, save, conflict, reload and switches. Screenshots: ${dir}`)
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
