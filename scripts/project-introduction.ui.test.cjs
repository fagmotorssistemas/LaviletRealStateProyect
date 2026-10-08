/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const esbuild = require('esbuild'), { chromium } = require('playwright')
const root = path.join(__dirname, '..'), nativeFs = require('node:fs')
const installedChrome = [process.env.PLAYWRIGHT_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(candidate => candidate && nativeFs.existsSync(candidate))
const initial = { projectName: 'La Vilet', mode: 'lanzamiento', pricesVisible: true, updatedAt: 'initial-version', configured: true,
  value: { stage: 'not_started', progress: '', verifiedOn: '2026-10-08', enabledPlaces: ['office'], primaryPlace: 'office', conditions: '', officeAtProjectSite: true },
  introduction: { configured: false, value: { enabled: false, summary: '', source: '' } },
  delivery: { configured: true, value: { enabled: false, timing: 'unknown', certainty: 'estimated', date: '', year: null, month: null, months: null, reference: 'date', referenceDate: '', conditions: '', source: '' } } }
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavilet-project-introduction-'))
  const entry = "import React from 'react';import {createRoot} from 'react-dom/client';import {ProjectReadinessSettings} from './src/components/inmobiliaria/automation/ProjectReadinessSettings';window.__writes=[];createRoot(document.getElementById('app')).render(<ProjectReadinessSettings projectId='project' initial={" + JSON.stringify(initial) + "}/>);"
  await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(dir, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [{ name: 'project-settings-fixture', setup(build) {
    build.onResolve({ filter: /automatizacion\/proyecto\/actions$/ }, args => ({ path: args.path, namespace: 'mock-actions' }))
    build.onLoad({ filter: /.*/, namespace: 'mock-actions' }, () => ({ loader: 'js', contents:
      "export async function saveProjectIntroduction(projectId,value,expectedUpdatedAt){window.__writes.push({projectId,value,expectedUpdatedAt,kind:'introduction'});return {ok:true,introduction:{configured:true,value},updatedAt:'intro-version'}};export async function saveProjectReadiness(projectId,value,expectedUpdatedAt){window.__writes.push({projectId,value,expectedUpdatedAt,kind:'readiness'});return {ok:true,configured:true,value,updatedAt:'readiness-version'}};export async function saveProjectDelivery(){throw Error('Not part of fixture')};" }))
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'mock-next' }))
    build.onLoad({ filter: /.*/, namespace: 'mock-next' }, () => ({ loader: 'jsx', resolveDir: root, contents: "import React from 'react';export default function Link(props){return <a {...props}/>;}" }))
    build.onResolve({ filter: /^@\/contexts\/VisitInboxContext$/ }, () => ({ path: 'inbox', namespace: 'mock-inbox' }))
    build.onLoad({ filter: /.*/, namespace: 'mock-inbox' }, () => ({ contents: 'export const useVisitInboxContext=()=>({pending:[],ready:true,error:null,openInbox(){}})' }))
    build.onResolve({ filter: /^@\/hooks\/useRoleAccess$/ }, () => ({ path: 'roles', namespace: 'mock-roles' }))
    build.onLoad({ filter: /.*/, namespace: 'mock-roles' }, () => ({ contents: 'export const useRoleAccess=()=>({isAdmin:true,isLoading:false})' }))
    build.onResolve({ filter: /^@\// }, args => ({ path: [path.join(root, 'src', args.path.slice(2)), path.join(root, 'src', args.path.slice(2)) + '.ts', path.join(root, 'src', args.path.slice(2)) + '.tsx'].find(candidate => nativeFs.existsSync(candidate)) }))
  } }] })
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/app.js') || req.url.startsWith('/app.css')) { const file = req.url.startsWith('/app.js') ? 'app.js' : 'app.css'; res.setHeader('Content-Type', file.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(dir, file))); return }
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Información del proyecto</title><link rel="stylesheet" href="/app.css"><style>body{font-family:Arial;margin:0;background:#f7f9f4}*{box-sizing:border-box}button{font:inherit}h1,h2,h3,p{margin:0}fieldset{border:0;padding:0}a{color:#365932}</style><div id="app"></div><script src="/app.js"></script></html>')
    } catch { res.statusCode = 500; res.end('fixture unavailable') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { dir, server, url: 'http://127.0.0.1:' + server.address().port }
}
test('desktop and mobile presentation editor help is accessible and harmless; saves propagate versions across independent project sections', { timeout: 60000 }, async () => {
  const f = await fixture(); let browser
  try {
    browser = await chromium.launch({ headless: true, ...(installedChrome ? { executablePath: installedChrome } : {}) })
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message)); await page.goto(f.url)
      const section = page.locator('#project-introduction'), enabled = section.getByRole('checkbox')
      assert.equal(await enabled.isChecked(), false)
      const help = section.getByRole('button', { name: 'Ayuda: Utilizar la presentación configurada', exact: true })
      if (mobile) await help.tap(); else await help.click()
      await page.getByRole('dialog').waitFor(); assert.match(await page.getByRole('dialog').innerText(), /consulta general/)
      await page.keyboard.press('Escape'); assert.equal(await help.evaluate(node => node === document.activeElement), true)
      assert.equal(await enabled.isChecked(), false); assert.equal(await page.evaluate(() => window.__writes.length), 0)
      await section.getByRole('textbox', { name: 'Resumen autorizado del proyecto', exact: false }).fill('La Vilet combina viviendas y locales comerciales en Cuenca.')
      await section.getByRole('textbox', { name: 'Fuente o responsable del resumen', exact: false }).fill('Responsable comercial')
      await enabled.check()
      assert.equal(await page.evaluate(() => window.__writes.length), 0)
      await section.getByRole('button', { name: 'Guardar presentación', exact: true }).click()
      await section.getByText('Presentación guardada. Se aplicará a las próximas consultas generales del proyecto.', { exact: true }).waitFor()
      await page.getByRole('combobox', { name: 'Estado de obra', exact: false }).selectOption('building')
      await page.getByRole('button', { name: 'Guardar y aplicar', exact: true }).click()
      await page.getByText('Guardado. Se aplicará a las próximas respuestas.', { exact: true }).waitFor()
      await enabled.uncheck(); await section.getByRole('button', { name: 'Guardar presentación', exact: true }).click()
      await section.getByText('Presentación guardada. Se aplicará a las próximas consultas generales del proyecto.', { exact: true }).waitFor()
      assert.match(await section.getByRole('textbox', { name: 'Resumen autorizado del proyecto', exact: false }).inputValue(), /viviendas/)
      const writes = await page.evaluate(() => window.__writes)
      assert.deepEqual(writes.map(write => write.kind), ['introduction', 'readiness', 'introduction'])
      assert.deepEqual(writes.map(write => write.expectedUpdatedAt), ['initial-version', 'intro-version', 'readiness-version'])
      assert.equal(writes[2].value.enabled, false); assert.equal(writes[2].value.summary, writes[0].value.summary)
      assert.deepEqual(errors, [])
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await page.screenshot({ path: path.join(f.dir, mobile ? 'mobile.png' : 'desktop.png'), fullPage: true })
      await context.close()
    }
    console.log('UI screenshots: ' + f.dir)
  } finally { await browser?.close(); await new Promise(resolve => f.server.close(resolve)) }
})
