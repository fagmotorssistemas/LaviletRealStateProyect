/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local browser fixture. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const esbuild = require('esbuild')
const { chromium } = require('playwright')

test('pipeline refresh retains cards, focus, scroll and drafts through a delayed refresh and a failed refresh', async () => {
  const root = path.resolve(__dirname, '..'), dir = path.join(root, 'tmp', 'pipeline-refresh-ui')
  await fs.mkdir(dir, { recursive: true })
  await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {useLeadPipeline} from './src/hooks/inmobiliaria/useLeadPipeline';
      window.__pending = null; window.__revision = 1;
      function App(){const s=useLeadPipeline(true);window.__refresh=s.reload;
        return <><output id="loading">{String(s.isLoading)}</output><output id="refreshing">{String(s.isRefreshing)}</output>
          <output id="error">{s.refreshError||''}</output>
          {s.isLoading?<p id="placeholder">Cargando</p>:<section id="board" style={{height:260,overflow:'auto'}}>
            <input aria-label="Nota del asesor" defaultValue="borrador"/>
            <div style={{height:1400}}>Tarjetas: <span id="total">{s.data?.total}</span></div>
          </section>}</>}
      createRoot(document.getElementById('app')).render(<App/>);` },
    bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(dir, 'app.js'),
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'mock-action', setup(build) {
      build.onResolve({ filter: /^@\/app\/inmobiliaria\/leads\/pipeline-actions$/ }, () => ({ path: 'action', namespace: 'mock' }))
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
        export async function listLeadPipelineAction(){
          if(window.__pending) return new Promise(resolve=>{window.__finish=resolve});
          return {ok:true,data:{columns:[],total:window.__revision}};
        }` }))
    } }],
  })
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(await fs.readFile(path.join(dir, 'app.js'))) }
    else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="es"><meta charset="utf-8"><div id="app"></div><script src="/app.js"></script></html>') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    browser = await chromium.launch({ headless: true, ...(require('node:fs').existsSync(chrome) ? { executablePath: chrome } : {}) })
    const page = await browser.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort())
    await page.goto('http://127.0.0.1:' + server.address().port)
    const draft = page.getByRole('textbox', { name: 'Nota del asesor' })
    await draft.fill('nota sin guardar'); await draft.focus()
    await page.locator('#board').evaluate(e => { e.scrollTop = 180 })
    await page.evaluate(() => { window.__pending = true; window.__refresh() })
    await page.waitForFunction(() => document.getElementById('refreshing').textContent === 'true')
    assert.equal(await page.locator('#loading').textContent(), 'false')
    assert.equal(await page.locator('#placeholder').count(), 0)
    assert.equal(await draft.inputValue(), 'nota sin guardar')
    assert.equal(await draft.evaluate(e => document.activeElement === e), true)
    assert.equal(await page.locator('#board').evaluate(e => e.scrollTop), 180)
    await page.evaluate(() => { window.__pending = false; window.__finish({ ok: true, data: { columns: [], total: 2 } }) })
    await page.waitForFunction(() => document.getElementById('total').textContent === '2')
    await page.evaluate(() => { window.__pending = true; window.__refresh() })
    await page.waitForFunction(() => document.getElementById('refreshing').textContent === 'true')
    await page.evaluate(() => { window.__finish({ ok: false, error: 'Error temporal simulado' }) })
    await page.waitForFunction(() => document.getElementById('error').textContent.includes('Error temporal'))
    assert.equal(await page.locator('#total').textContent(), '2')
    assert.equal(await draft.inputValue(), 'nota sin guardar')
    assert.equal(await draft.evaluate(e => document.activeElement === e), true)
    assert.equal(await page.locator('#board').evaluate(e => e.scrollTop), 180)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: path.join(dir, 'background-error-preserves-board.png') })
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
})
