/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const esbuild = require('esbuild'), { chromium } = require('playwright')
const root = path.join(__dirname, '..')
const installedChrome = [process.env.PLAYWRIGHT_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(candidate => candidate && require('node:fs').existsSync(candidate))
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavilet-demo-review-ui-'))
  const entry = "import React from 'react'; import {createRoot} from 'react-dom/client'; import {ResponseReviewControl} from './src/components/inmobiliaria/automation/ResponseReviewControl'; window.__state={enabled:false,observationOnly:false,updatedAt:null,version:'v1'}; window.__writes=[]; window.__fail=false; createRoot(document.getElementById('app')).render(<ResponseReviewControl initial={{ok:true,state:window.__state}}/>);"
  await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(dir, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [{ name: 'isolated-review-ui', setup(build) {
    build.onResolve({ filter: /pruebas\/review-actions$/ }, args => ({ path: args.path, namespace: 'mock-actions' }))
    build.onLoad({ filter: /.*/, namespace: 'mock-actions' }, () => ({ loader: 'js', contents:
      "export async function loadResponseReviewAction(){return {ok:true,state:window.__state}}; async function save(kind,value,version){window.__writes.push({kind,value,version}); if(window.__fail)return {ok:false,error:'La configuración cambió. Pulse «Actualizar estado» antes de volver a guardar.'}; window.__state={...window.__state,version:'v'+(window.__writes.length+1),...(kind==='observation'?{observationOnly:value}:{enabled:value,...(!value?{observationOnly:false}:{})})};return {ok:true,state:window.__state}};export async function saveResponseReviewAction(value,version){return save('review',value,version)};export async function saveResponseReviewObservationAction(value,version){return save('observation',value,version)};" }))
    build.onResolve({ filter: /^@\// }, args => ({ path: [path.join(root, 'src', args.path.slice(2)), path.join(root, 'src', args.path.slice(2)) + '.ts', path.join(root, 'src', args.path.slice(2)) + '.tsx'].find(candidate => require('node:fs').existsSync(candidate)) }))
  } }] })
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/app.js') || req.url.startsWith('/app.css')) { const file = req.url.startsWith('/app.js') ? 'app.js' : 'app.css'; res.setHeader('Content-Type', file.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(dir, file))); return }
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Modo demostración aislado</title><link rel="stylesheet" href="/app.css"><style>body{font-family:Arial;margin:0;background:#f7f9f4}*{box-sizing:border-box}button{font:inherit}</style><div id="app"></div><script src="/app.js"></script></html>')
    } catch { res.statusCode = 500; res.end('fixture unavailable') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { dir, server, url: 'http://127.0.0.1:' + server.address().port }
}
test('demo toggle and help work on desktop and mobile; failed save requires refresh and mount never activates', { timeout: 45000 }, async () => {
  const f = await fixture(); let browser
  try {
    browser = await chromium.launch({ headless: true, ...(installedChrome ? { executablePath: installedChrome } : {}) })
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message)); await page.goto(f.url)
      assert.equal(await page.evaluate(() => window.__writes.length), 0)
      const help = page.getByRole('button', { name: 'Ayuda: Modo demostración', exact: true })
      if (mobile) await help.tap(); else await help.click()
      await page.getByRole('dialog', { name: 'Modo demostración', exact: true }).waitFor()
      assert.match(await page.getByRole('dialog').innerText(), /Solo a contactos de prueba/)
      assert.match(await page.getByRole('dialog').innerText(), /El extractor, la planificación, las rutas y los permisos conservan su funcionamiento habitual/)
      await page.keyboard.press('Escape')
      assert.equal(await help.evaluate(node => node === document.activeElement), true)
      await page.getByRole('button', { name: 'Activar modo demostración', exact: true }).click()
      await page.getByText('Demostración activada.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Desactivar modo demostración', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.deepEqual(await page.evaluate(() => window.__state), { enabled: false, observationOnly: true, updatedAt: null, version: 'v2' })
      await page.screenshot({ path: path.join(f.dir, mobile ? 'mobile-demo.png' : 'desktop-demo.png'), fullPage: true })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await page.getByRole('button', { name: 'Desactivar modo demostración', exact: true }).click()
      await page.getByText('Demostración desactivada.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.__state.enabled), false)
      await page.getByRole('button', { name: 'Activar revisión general', exact: true }).click()
      await page.getByText('Revisión activada.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Activar modo demostración', exact: true }).click()
      await page.getByText('Demostración activada.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Desactivar revisión general', exact: true }).click()
      await page.getByText('Revisión desactivada.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.__state.observationOnly), false)
      await page.evaluate(() => { window.__fail = true })
      await page.getByRole('button', { name: 'Activar modo demostración', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.equal(await page.getByRole('button', { name: 'Activar modo demostración', exact: true }).isDisabled(), true)
      await page.evaluate(() => { window.__fail = false })
      await page.getByRole('button', { name: 'Actualizar estado', exact: true }).click()
      await page.getByText('Estado actualizado.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Activar modo demostración', exact: true }).isDisabled(), false)
      assert.deepEqual(await page.evaluate(() => window.__writes.map(write => write.kind)), ['observation', 'observation', 'review', 'observation', 'review', 'observation'])
      assert.deepEqual(errors, [])
      await context.close()
    }
    console.log('Demo UI screenshots: ' + f.dir)
  } finally { await browser?.close(); await new Promise(resolve => f.server.close(resolve)) }
})
