// Exercise the actual card with a mocked server action: no credentials or live writes.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { webpack } = require('next/dist/compiled/webpack/webpack')
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'tmp', 'lead-profile-card')

async function main() {
  fs.mkdirSync(dir, { recursive: true })
  const loader = path.join(dir, 'loader.cjs'), entry = path.join(dir, 'entry.tsx'), action = path.join(dir, 'action.ts')
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
  fs.writeFileSync(action, `export async function saveFinancingReview(...args){if(window.failSave)throw Error('La ficha cambió. Ábrala de nuevo antes de guardar.');window.savedReview=args;return{updatedAt:'new-version'}}`)
  fs.writeFileSync(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{LeadProfileCard}from'@/components/inmobiliaria/automation/LeadProfileCard';import{leadProfileCard}from'@/lib/inmobiliaria/leadProfileCard';
    const data=leadProfileCard({name:'Carlos',phone:'Número de prueba',updated_at:'version',purchase_purpose:'vivir'},
      {_lead_profile:{full_name:'Carlos',name_status:'confirmed',residence_city:'Cuenca',residence_country:'Ecuador'},_interpretation_memory:{budget:{status:'amount',amount:50000}},_property_context:{selected_ids:['unit'],query:{filters:{bedrooms:3,floor_number:5}}},_financing_journey:{accepted:true},_commercial_journey:{stage:'continue_financing',next_step:'Completar revisión de la unidad elegida'}},
      {explicit_consent:true,status:'lista',national_id:'0101234567'},[{id:'unit',unit_number:'502',category:'departamento'}]);
    createRoot(document.getElementById('root')).render(<LeadProfileCard leadId='lead' data={data}/>);`)
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root })]).process('@import "tailwindcss";', { from: path.join(root, 'preview.css') })
  fs.writeFileSync(path.join(dir, 'styles.css'), css.css)
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry,
    output: { path: dir, filename: 'bundle.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules')],
      alias: { '@/app/inmobiliaria/automatizacion/financing-review-actions': action, '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : resolve()))
  const server = http.createServer((req, res) => {
    if (['/bundle.js', '/styles.css'].includes(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'); res.end(fs.readFileSync(path.join(dir, req.url.slice(1)))); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{font-family:Arial;margin:20px;background:#f6f8f3}main{max-width:960px;margin:auto}h1{font-size:24px;margin-bottom:20px}</style><main><h1>Ficha del lead</h1><div id="root"></div></main><script src="/bundle.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined })
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.getByRole('heading', { name: 'Presupuesto y financiamiento' }).waitFor()
      assert.match(await page.locator('body').innerText(), /departamento 502/)
      assert.doesNotMatch(await page.locator('body').innerText(), /0101234567/)
      await page.getByText('Registrar resultado de la revisión financiera', { exact: true }).click()
      await page.getByLabel('Resultado', { exact: true }).selectOption('favorable')
      await page.getByLabel('Aporte propio revisado (USD)').fill('50000')
      await page.getByLabel('Financiamiento revisado (USD)').fill('260000')
      await page.getByLabel('Resultado y respaldo de la revisión').fill('Revisión comprobada por el equipo de prueba')
      await page.getByRole('button', { name: 'Guardar resultado' }).click()
      await page.getByRole('status').filter({ hasText: 'Resultado guardado' }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.savedReview.slice(0, 3)), ['lead', 'unit', 'version'])
      await page.evaluate(() => { window.failSave = true })
      await page.getByRole('button', { name: 'Guardar resultado' }).click()
      await page.getByRole('status').filter({ hasText: 'La ficha cambió' }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(dir, `card-${width}.png`), fullPage: true })
      await page.close()
    }
    console.log(JSON.stringify({ result: 'passed', widths: [1280, 390], checks: ['profile values', 'masked identity', 'review save', 'stale save error', 'no overflow'], screenshots: dir }))
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
