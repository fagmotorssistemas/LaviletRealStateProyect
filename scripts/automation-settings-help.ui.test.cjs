/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const esbuild = require('esbuild'), { chromium } = require('playwright')
const root = path.join(__dirname, '..')
const installedChrome = [process.env.PLAYWRIGHT_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(candidate => candidate && require('node:fs').existsSync(candidate))
const seed = { id: '40b31a51-8c57-4b0b-8dc1-8e7548b3cb32', updatedAt: '2026-10-01T00:00:00.000Z', status: 'published',
  draft: { headline: 'Servicios verificados', category: 'nearby_services', fact_text: 'Servicios del sector confirmados por el responsable.', safe_sales_text: 'El sector cuenta con servicios cotidianos confirmados.', source_name: 'Responsable del proyecto', source_url: '', verified_on: '2026-01-01', audiences: ['residential'], commercial_modes: ['lanzamiento'] } }
seed.published = { ...seed.draft }
const policy = { id: 'policy-1', draft: { title: 'Condiciones confirmadas', topic: 'compra_exterior', content: 'Contenido confirmado de ejemplo', scope: 'Compradores del proyecto', source: 'Responsable del proyecto', mode: 'todos', validUntil: '' }, published: null, history: [] }
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavilet-settings-help-'))
  const entry = "import React from 'react'; import {createRoot} from 'react-dom/client'; import {KnowledgeCenter} from './src/components/inmobiliaria/automation/KnowledgeCenter'; import {SettingsFieldHelp} from './src/components/inmobiliaria/automation/SettingsHelp'; window.__writes=[]; createRoot(document.getElementById('app')).render(<><label><input id='native-check' type='checkbox'/>Control protegido<SettingsFieldHelp title='Control protegido' section='proyecto'/></label><KnowledgeCenter projectId='project' initial={" + JSON.stringify({ projectName: 'La Vilet', updatedAt: '2026-10-01T00:00:00Z', state: { revision: 0, items: [policy] }, catalogSearch: { embeddingsEnabled: true }, areaFacts: [seed], areaError: '' }) + "} section={new URLSearchParams(location.search).get('section') || 'proyecto'} /></>);"
  await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(dir, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [{ name: 'isolated-ui-fixture', setup(build) {
    build.onResolve({ filter: /conocimiento\/(?:area-fact-actions|actions)$/ }, args => ({ path: args.path, namespace: 'mock-actions' }))
    build.onLoad({ filter: /.*/, namespace: 'mock-actions' }, () => ({ loader: 'js', contents:
      "export async function saveProjectAreaFact(projectId,cmd){window.__writes.push({projectId,cmd});const draft=cmd.value;return {id:cmd.id,updatedAt:'2026-10-07T19:00:00Z',draft,published:cmd.action==='publish'?draft:cmd.action==='pause'?null:" + JSON.stringify(seed.published) + ",status:cmd.action==='pause'?'paused':'published'}}; export async function saveBusinessPolicy(){throw Error('Not part of fixture')}; export async function saveCatalogSearch(){throw Error('Not part of fixture')};" }))
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'mock-next' }))
    build.onLoad({ filter: /.*/, namespace: 'mock-next' }, () => ({ loader: 'jsx', resolveDir: root, contents: "import React from 'react'; export default function Link(props){return <a {...props}/>;}" }))
    build.onResolve({ filter: /^@\/contexts\/VisitInboxContext$/ }, () => ({ path: 'inbox', namespace: 'mock-inbox' }))
    build.onLoad({ filter: /.*/, namespace: 'mock-inbox' }, () => ({ contents: 'export const useVisitInboxContext=()=>({pending:[],ready:true,error:null,openInbox(){}})' }))
    build.onResolve({ filter: /^@\/hooks\/useRoleAccess$/ }, () => ({ path: 'roles', namespace: 'mock-roles' }))
    build.onLoad({ filter: /.*/, namespace: 'mock-roles' }, () => ({ contents: 'export const useRoleAccess=()=>({isAdmin:true,isLoading:false})' }))
    build.onResolve({ filter: /^@\// }, args => ({ path: [path.join(root, 'src', args.path.slice(2)), path.join(root, 'src', args.path.slice(2)) + '.ts', path.join(root, 'src', args.path.slice(2)) + '.tsx'].find(candidate => require('node:fs').existsSync(candidate)) }))
  } }] })
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/app.js') || req.url.startsWith('/app.css')) { const file = req.url.startsWith('/app.js') ? 'app.js' : 'app.css'; res.setHeader('Content-Type', file.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(dir, file))); return }
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ayudas aisladas</title><link rel="stylesheet" href="/app.css"><style>body{font-family:Arial;margin:0;background:#f7f9f4}*{box-sizing:border-box}button{font:inherit}h1,h2,h3,p{margin:0}fieldset{border:0;padding:0}a{color:#365932}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}</style><div id="app"></div><script src="/app.js"></script></html>')
    } catch { res.statusCode = 500; res.end('fixture unavailable') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { dir, server, url: 'http://127.0.0.1:' + server.address().port }
}
test('desktop and mobile help open by click or touch; keyboard Escape restores focus without a write', { timeout: 45000 }, async () => {
  const f = await fixture(); let browser
  try {
    browser = await chromium.launch({ headless: true, ...(installedChrome ? { executablePath: installedChrome } : {}) })
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message)); await page.goto(f.url)
      const help = page.getByRole('button', { name: 'Ayuda: Conocimiento y reglas', exact: true })
      if (mobile) await help.tap(); else await help.click()
      await page.getByRole('dialog', { name: 'Conocimiento y reglas', exact: true }).waitFor()
      for (const heading of ['Qué configura', 'Cómo lo utiliza el bot', 'Cuándo aplica', 'Guardar o publicar']) assert.equal(await page.getByRole('dialog').getByText(heading, { exact: true }).count(), 1)
      await page.screenshot({ path: path.join(f.dir, mobile ? 'mobile-help.png' : 'desktop-help.png') });
      const rect = await page.getByRole('dialog').boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= (mobile ? 390 : 1366))
      await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await help.evaluate(node => node === document.activeElement), true)
      await help.focus(); await page.keyboard.press('Enter'); await page.getByRole('dialog').waitFor()
      await page.getByRole('button', { name: 'Cerrar ayuda', exact: true }).click()
      assert.equal(await help.evaluate(node => node === document.activeElement), true)
      assert.equal(await page.evaluate(() => window.__writes.length), 0); assert.deepEqual(errors, [])
      await page.getByRole('button', { name: 'Ayuda: Control protegido', exact: true }).click(); await page.keyboard.press('Escape')
      assert.equal(await page.locator('#native-check').isChecked(), false)
      await page.locator('label').filter({ has: page.locator('#native-check') }).click({ position: { x: 80, y: 12 } })
      assert.equal(await page.locator('#native-check').isChecked(), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await page.screenshot({ path: path.join(f.dir, mobile ? 'mobile.png' : 'desktop.png'), fullPage: true })
      await context.close()
    }
    console.log('UI screenshots: ' + f.dir)
  } finally { await browser?.close(); await new Promise(resolve => f.server.close(resolve)) }
})
test('environment editor preserves published preview after draft save and requires approval to publish; policy field help works on desktop', { timeout: 45000 }, async () => {
  const f = await fixture(); let browser
  try {
    browser = await chromium.launch({ headless: true, ...(installedChrome ? { executablePath: installedChrome } : {}) })
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }); await page.goto(f.url)
    await page.getByRole('button', { name: 'Ver y editar ficha', exact: true }).click()
    await page.getByRole('button', { name: 'Ayuda: Redacción autorizada', exact: true }).click()
    await page.getByRole('dialog', { name: 'Redacción autorizada', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    const titleInput = page.locator('#entorno input[maxlength="120"]');
    assert.equal(await titleInput.evaluate(node => node.closest('label').control === node), true);
    await titleInput.locator('..').locator('span').first().click({ position: { x: 5, y: 5 } });
    assert.equal(await titleInput.evaluate(node => document.activeElement === node), true);
    await page.getByLabel('Redacción autorizada para el cliente', { exact: false }).fill('Nueva descripción del sector pendiente de publicar.')
    assert.equal(await page.getByRole('button', { name: 'Publicar ficha verificada', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click()
    await page.getByText('Borrador guardado. El bot conserva la información ya publicada.', { exact: true }).waitFor()
    assert.equal(await page.locator('article').getByText(seed.published.safe_sales_text, { exact: true }).count(), 1)
    await page.getByLabel('He revisado la fuente y autorizo').check()
    await page.getByRole('button', { name: 'Publicar ficha verificada', exact: true }).click()
    await page.getByText('Ficha publicada y aprobada para las próximas respuestas a las que aplique.', { exact: true }).waitFor()
    assert.equal(await page.locator('article').getByText('Nueva descripción del sector pendiente de publicar.', { exact: true }).count(), 1)
    await page.screenshot({ path: path.join(f.dir, 'editor.png'), fullPage: true });
    const writes = await page.evaluate(() => window.__writes); assert.deepEqual(writes.map(value => value.cmd.action), ['draft', 'publish']); assert.equal(writes[1].cmd.confirmed, true)
    await page.goto(f.url + '?section=politicas')
    await page.getByRole('button', { name: 'Ver y editar', exact: true }).click()
    await page.getByRole('button', { name: 'Ayuda: Alcance y excepciones', exact: true }).click()
    await page.getByRole('dialog', { name: 'Alcance y excepciones', exact: true }).waitFor()
    assert.match(await page.getByRole('dialog').innerText(), /Guardar borrador conserva/)
  } finally { await browser?.close(); await new Promise(resolve => f.server.close(resolve)) }
})
