/* eslint-disable @typescript-eslint/no-require-imports -- Browser integration harness. */
// Real admin page with in-memory API and upload fixtures. No database/storage writes.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict')
const { chromium } = require('playwright'), { webpack } = require('next/dist/compiled/webpack/webpack'), { compile } = require('@tailwindcss/node')
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construction-editor-'))
const file = 'src/app/inmobiliaria/inventario/avance-de-obra/page.tsx'
async function main() {
  fs.writeFileSync(path.join(dir, 'role.js'), 'export const useRoleAccess=()=>({canWrite:!location.search.includes("readonly")})')
  fs.writeFileSync(path.join(dir, 'storage.js'), 'export const createClient=()=>({storage:{from:()=>({uploadToSignedUrl:async()=>({error:null})})}})')
  fs.writeFileSync(path.join(dir, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
  fs.writeFileSync(path.join(dir, 'entry.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import Page from '${path.join(root, file).replace(/\\/g, '/')}';createRoot(document.getElementById('root')).render(<Page/>);`)
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry: path.join(dir, 'entry.tsx'), output: { path: dir, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules')], alias: { '@/hooks/useRoleAccess': path.join(dir, 'role.js'), '@supabase/supabase-js': path.join(dir, 'storage.js'), '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(dir, 'loader.cjs') }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : resolve()))
  const css = (await compile('@import "tailwindcss";', { base: root, onDependency() {} })).build(fs.readFileSync(path.join(root, file), 'utf8').split(/[\s"'`]+/))
  let items, patches = 0, failSave = false
  const reset = () => { patches = 0; items = [
    { id: 'one', date: '2026-10-13', description: 'Descripción original', media: [{ type: 'image', url: '/photo-a.svg', caption: '' }, { type: 'image', url: '/photo-b.svg', caption: '' }] },
    { id: 'two', date: '2026-10-12', description: '', media: [{ type: 'image', url: '/photo-b.svg', caption: '' }] },
  ] }
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://local')
    response.setHeader('Content-Type', 'application/json')
    if (url.pathname === '/api/tour/construction-updates' && request.method === 'GET') return response.end(JSON.stringify({ items }))
    if (url.pathname === '/api/tour/construction-updates/prepare') return response.end(JSON.stringify({ bucket: 'test', path: 'upload.png', token: 'test', storage_path: 'upload.png', file_name: 'upload.png', content_type: 'image/png' }))
    if (url.pathname === '/api/tour/construction-updates/convert') return response.end(JSON.stringify({ type: 'image', url: '/photo-new.svg' }))
    if (url.pathname === '/api/tour/construction-updates/one' && request.method === 'PATCH') {
      let body = ''; for await (const chunk of request) body += chunk
      if (failSave) { response.statusCode = 500; return response.end(JSON.stringify({ error: 'Fallo simulado' })) }
      Object.assign(items[0], JSON.parse(body)); patches++; return response.end(JSON.stringify({ item: items[0] }))
    }
    if (url.pathname.startsWith('/photo-')) { response.setHeader('Content-Type', 'image/svg+xml'); return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#bda27e"/></svg>') }
    if (url.pathname.endsWith('.js')) { response.setHeader('Content-Type', 'text/javascript'); return response.end(fs.readFileSync(path.join(dir, path.basename(url.pathname)))) }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{padding:20px}</style><div id="root"></div><script>window.process={env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test'}}</script><script src="/bundle.js"></script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const browser = await chromium.launch()
  try {
    for (const width of [1254, 360]) {
      reset(); const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort())
      await page.goto(`http://127.0.0.1:${server.address().port}`); await page.locator('article').nth(1).waitFor()
      const editor = page.locator('#construction-editor'), edit = page.getByRole('button', { name: 'Editar avance del 2026-10-13', exact: true })
      await edit.click(); assert.equal(await page.getByLabel('Descripción', { exact: true }).inputValue(), 'Descripción original')
      await page.getByLabel('Descripción', { exact: true }).fill('No guardar')
      await page.getByRole('button', { name: 'Cancelar edición', exact: true }).click(); assert.equal(patches, 0); assert.equal(items[0].description, 'Descripción original')
      await edit.click(); await page.getByLabel('Descripción', { exact: true }).fill('Descripción actualizada\nSegunda línea')
      await page.getByLabel('Cambiar archivo 1', { exact: true }).setInputFiles({ name: 'nueva.png', mimeType: 'image/png', buffer: Buffer.from('test') })
      await editor.locator('img[src="/photo-new.svg"]').waitFor(); assert.equal(await editor.locator('img[src="/photo-b.svg"]').count(), 1)
      const save = page.getByRole('button', { name: 'Guardar cambios', exact: true })
      failSave = true; const failed = page.waitForResponse(r => r.request().method() === 'PATCH'); await save.click(); assert.equal((await failed).status(), 500)
      await save.waitFor(); assert.equal(await page.getByLabel('Descripción', { exact: true }).inputValue(), 'Descripción actualizada\nSegunda línea'); assert.equal(patches, 0)
      failSave = false; await save.click(); await editor.getByRole('heading', { name: 'Nueva entrada', exact: true }).waitFor()
      assert.equal(items.length, 2); assert.equal(patches, 1); assert.equal(items[0].description, 'Descripción actualizada\nSegunda línea')
      assert.deepEqual(items[0].media.map(file => file.url), ['/photo-new.svg', '/photo-b.svg'])
      await page.reload(); await page.locator('article').first().getByText('Descripción actualizada\nSegunda línea', { exact: true }).waitFor()
      await edit.click(); await editor.getByRole('button', { name: 'Quitar archivo', exact: true }).first().click(); await save.click()
      await editor.getByRole('heading', { name: 'Nueva entrada', exact: true }).waitFor(); assert.deepEqual(items[0].media.map(file => file.url), ['/photo-b.svg'])
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(dir, `${width}.png`) }); await page.close(); console.log('PASS editing description, replacing/removing photos, cancellation, save failure and persistence', width)
    }
    const readonly = await browser.newPage(); await readonly.goto(`http://127.0.0.1:${server.address().port}/?readonly`)
    await readonly.locator('article').first().waitFor(); assert.equal(await readonly.locator('#construction-editor').count(), 0); assert.equal(await readonly.getByRole('button', { name: /Editar avance/ }).count(), 0); await readonly.close()
  } finally { await browser.close(); server.close() }
  console.log('Screenshots:', dir)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
