/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), syncFs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const esbuild = require('esbuild'), { chromium } = require('playwright')
const root = path.join(__dirname, '..')
const installedChrome = [process.env.PLAYWRIGHT_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(candidate => candidate && syncFs.existsSync(candidate))
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavilet-price-notice-ui-'))
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {UnitPricesView} from './src/components/inmobiliaria/automation/UnitPricesView';
    window.__state={units:[],mode:'lanzamiento',launchVisible:true,referentialNoticeEnabled:true,projectUpdatedAt:'v1'};window.__writes=[];window.__fail=false;
    createRoot(document.getElementById('app')).render(<UnitPricesView/>);`
  const mocks = {
    '@/app/inmobiliaria/automatizacion/precios/actions': `export async function loadUnitPricesAction(){return window.__state};
      async function save(kind,p){window.__writes.push({kind,...p});if(window.__fail)throw Error('La configuración del proyecto cambió.');window.__state={...window.__state,projectUpdatedAt:'v'+(window.__writes.length+1),...(kind==='notice'?{referentialNoticeEnabled:p.enabled}:{launchVisible:p.visible})};return window.__state};
      export async function saveReferentialPriceNoticeAction(p){return save('notice',p)};export async function saveLaunchPriceVisibilityAction(p){return save('visibility',p)};export async function saveUnitPriceAction(){throw Error('Unexpected unit save')};`,
    '@/contexts/AuthContext': `const supabase={},user={id:'admin'};export function useAuth(){return {supabase,user,isLoading:false}}`,
    '@/lib/inmobiliaria/tenants': `export async function getAccessibleTenantIds(){return ['tenant']}`,
    '@/services/inmobiliaria.service': `export async function listProjects(){return [{id:'project',name:'La Vilet'}]}`,
    '@/lib/integrations/lavilet': `export const LAVILET_PROJECT_ID='project'`,
    './AutomationSettings': `import React from 'react';export const automationSettingsStyles={};export function AutomationSettingsHeader(p){return <header><h1>{p.title}</h1>{p.project}</header>};export function AutomationSettingsSummary(){return null}`,
    'next/link': `import React from 'react';export default function Link(p){return <a href={p.href} className={p.className}>{p.children}</a>}`,
  }
  await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(dir, 'app.js'), platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [{ name: 'isolated-price-notice', setup(build) {
      build.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined)
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'tsx', contents: mocks[args.path], resolveDir: root }))
      build.onResolve({ filter: /^@\// }, args => ({ path: [path.join(root, 'src', args.path.slice(2)), path.join(root, 'src', args.path.slice(2)) + '.ts', path.join(root, 'src', args.path.slice(2)) + '.tsx'].find(candidate => syncFs.existsSync(candidate)) }))
    } }] })
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/app.js') || req.url.startsWith('/app.css')) {
        const file = req.url.startsWith('/app.js') ? 'app.js' : 'app.css';res.setHeader('Content-Type', file.endsWith('css') ? 'text/css' : 'text/javascript');res.end(await fs.readFile(path.join(dir, file)));return
      }
      res.setHeader('Content-Type', 'text/html');res.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Precio y aclaración</title><link rel="stylesheet" href="/app.css"><style>body{font-family:Arial;margin:12px}*{box-sizing:border-box}button{font:inherit}</style><div id="app"></div><script src="/app.js"></script></html>')
    } catch { res.statusCode = 500;res.end('fixture unavailable') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { dir, server, url: 'http://127.0.0.1:' + server.address().port }
}

test('notice toggle, help and saves remain independent from price visibility on desktop and mobile', { timeout: 45000 }, async () => {
  const f = await fixture();let browser
  try {
    browser = await chromium.launch({ headless: true, ...(installedChrome ? { executablePath: installedChrome } : {}) })
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, isMobile: mobile, hasTouch: mobile })
      const page = await context.newPage(), errors = [];page.on('pageerror', error => errors.push(error.message));await page.goto(f.url)
      const notice = page.locator('#referential-price-notice'), visibility = page.locator('#launch-price-visibility')
      await notice.waitFor();assert.equal(await notice.isChecked(), true);assert.equal(await visibility.isChecked(), true)
      assert.equal(await page.evaluate(() => window.__writes.length), 0)
      const help = page.getByRole('button', { name: 'Ayuda: Aclaración automática de precios', exact: true })
      if (mobile) await help.tap();else await help.click()
      await page.getByRole('dialog', { name: 'Aclaración automática de precios', exact: true }).waitFor()
      assert.match(await page.getByRole('dialog').innerText(), /No vuelve fijos los precios/)
      await page.keyboard.press('Escape');assert.equal(await notice.isChecked(), true)
      await notice.uncheck();assert.equal(await visibility.isChecked(), true)
      await page.getByRole('button', { name: 'Guardar aclaración', exact: true }).click()
      await page.getByText('El aviso automático está desactivado. Las consultas sobre vigencia o cambios se siguen respondiendo.', { exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.__writes[0]), { kind: 'notice', projectId: 'project', enabled: false, expectedUpdatedAt: 'v1' })
      await visibility.uncheck();await page.getByRole('button', { name: 'Guardar visibilidad', exact: true }).click()
      await page.waitForFunction(() => window.__writes.length === 2)
      assert.deepEqual(await page.evaluate(() => window.__writes[1]), { kind: 'visibility', projectId: 'project', visible: false, expectedUpdatedAt: 'v2' })
      assert.equal(await notice.isChecked(), false)
      await page.evaluate(() => { window.__fail = true });await notice.check();await page.getByRole('button', { name: 'Guardar aclaración', exact: true }).click()
      await page.waitForFunction(() => window.__writes.length === 3)
      assert.equal(await page.evaluate(() => window.__state.referentialNoticeEnabled), false)
      await page.getByRole('button', { name: 'Descartar cambios', exact: true }).click();assert.equal(await notice.isChecked(), false)
      await page.screenshot({ path: path.join(f.dir, mobile ? 'mobile.png' : 'desktop.png'), fullPage: true })
      assert.deepEqual(errors, []);await context.close()
    }
    console.log('Price notice UI screenshots: ' + f.dir)
  } finally { await browser?.close();await new Promise(resolve => f.server.close(resolve)) }
})
