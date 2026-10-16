/* eslint-disable @typescript-eslint/no-require-imports -- Isolated browser integration harness. */
// Real showroom components, synthetic dated media, no external requests or database writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')
const { webpack } = require('next/dist/compiled/webpack/webpack')
const { compile } = require('@tailwindcss/node')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construction-board-'))

async function main() {
  const entry = path.join(dir, 'entry.tsx'), loader = path.join(dir, 'loader.cjs')
  const components = ['TourConstructionBoard', 'TourAmenitiesGallery', 'ShowroomMenu']
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
  fs.writeFileSync(entry, `import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
    ${components.map(name => `import {${name}} from '${path.join(root, 'src/components/tour', name).replace(/\\/g, '/')}';`).join('\n')}
    function App(){const root=useRef(null),[open,setOpen]=useState(false),[photo,setPhoto]=useState(null);return <div ref={root} className="tour-root" style={{position:'fixed',inset:0}}><p>Recorrido</p>
      <ShowroomMenu root={root} units={[]} catalog={{typologies:[]}} selected={null} hidden={open} onPick={()=>{}} onTour={()=>{}} onHome={()=>{}} onClosePanels={()=>{}} onConstructionProgress={()=>{setOpen(true);setPhoto(null)}}/>
      <TourConstructionBoard open={open&&photo===null} onClose={()=>setOpen(false)} onOpenPhoto={setPhoto}/>
      <TourAmenitiesGallery key={photo??'construction'} open={open&&photo!==null} source="construction" initialIndex={photo??0} onClose={()=>setPhoto(null)}/>
    </div>}createRoot(document.getElementById('root')).render(<App/>);`)
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry,
    output: { path: dir, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules')], alias: { '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : resolve()))
  const css = (await compile('@import "tailwindcss";', { base: root, onDependency() {} })).build(
    components.flatMap(name => fs.readFileSync(path.join(root, 'src/components/tour', name + '.tsx'), 'utf8').split(/[\s"'`]+/)),
  ) + fs.readFileSync(path.join(root, 'src/components/tour/tour-viewer.css'), 'utf8')
  let mode = 'ready'
  const image = n => ({ type: 'image', url: `/photo-${n}.svg`, caption: `Foto ${n}` })
  const video = n => ({ type: 'video', url: `/video-${n}.mp4`, caption: `Video ${n}` })
  const updates = [
    { id: 'oct', date: '2026-10-14', title: '', description: '', media: [image(0), video(0), image(1), image(2), image(3)] },
    { id: 'sep', date: '2026-09-01', title: '', description: '', media: [video(1), image(4), image(5)] },
  ]
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tour/construction-updates') {
      res.setHeader('Content-Type', 'application/json')
      return setTimeout(() => { res.statusCode = mode === 'error' ? 500 : 200; res.end(JSON.stringify({ items: mode === 'empty' ? [] : mode === 'video' ? [{ ...updates[0], media: [video(0)] }] : updates })) }, 200)
    }
    const photo = /^\/photo-(\d)\.svg$/.exec(req.url)
    if (photo) {
      res.setHeader('Content-Type', 'image/svg+xml')
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#8e7654"/><text x="200" y="400" font-size="200">Foto ${photo[1]}</text></svg>`)
    }
    if (req.url.startsWith('/video-')) { res.writeHead(204); return res.end() }
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html; charset=utf-8')
    res.end(req.url === '/bundle.js' ? fs.readFileSync(path.join(dir, 'bundle.js')) : `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>window.process={env:{}}</script><script src="/bundle.js"></script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch()
  try {
    for (const width of [390, 800, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce', hasTouch: width < 1000 })
      const errors = []; page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort())
      const openBoard = async () => {
        await page.getByRole('button', { name: 'Abrir menú del showroom' }).click()
        await page.getByRole('button', { name: 'Avance de obra', exact: true }).click()
      }
      const board = page.getByRole('dialog', { name: 'Avance de obra', exact: true })
      const close = () => page.getByRole('button', { name: 'Cerrar', exact: true }).click()
      mode = 'ready'; await page.goto(`http://127.0.0.1:${server.address().port}`); await openBoard()
      await page.getByRole('status').getByText('Cargando…').waitFor()
      await board.locator('img').nth(5).waitFor()
      assert.match(await board.locator('header').innerText(), /Última actualización\s+14 de octubre de 2026/i)
      assert.equal(await board.locator('button time[datetime="2026-10-14"]').count(), 4)
      assert.equal(await board.locator('button time').first().textContent(), 'octubre 2026')
      assert.equal(await board.locator('button time[datetime="2026-09-01"]').count(), 2)
      assert.equal(await board.locator('video[controls][preload="metadata"]').count(), 2)
      const grid = board.locator('div.grid').last()
      assert.equal(await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), width < 640 ? 1 : width < 1024 ? 2 : 3)
      assert.ok(await board.evaluate(el => el.scrollWidth <= el.clientWidth), 'no horizontal scrolling')
      assert.deepEqual(await grid.evaluate(el => [...el.children].map(child => child.tagName)), ['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON', 'BUTTON', 'BUTTON', 'DIV', 'DIV'])
      await page.screenshot({ path: path.join(dir, `board-${width}.png`) })
      for (const index of [5, 0, 3]) {
        await board.locator('button:has(img)').nth(index).click()
        await board.waitFor({ state: 'hidden' })
        await page.waitForFunction(index => document.querySelector('img.opacity-100')?.getAttribute('src') === `/photo-${index}.svg`, index)
        await page.getByRole('button', { name: 'Alejar', exact: true }).click()
        await page.getByRole('button', { name: 'Acercar', exact: true }).click()
        await page.getByRole('button', { name: 'Imagen siguiente', exact: true }).click()
        await page.waitForFunction(index => document.querySelector('img.opacity-100')?.getAttribute('src') === `/photo-${(index + 1) % 6}.svg`, index)
        const surface = page.locator('div.touch-none')
        await surface.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 250, clientY: 400 })
        await surface.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 400 })
        await page.waitForFunction(index => document.querySelector('img.opacity-100')?.getAttribute('src') === `/photo-${(index + 2) % 6}.svg`, index)
        await close(); await board.locator('img').nth(5).waitFor()
      }
      await close(); await board.waitFor({ state: 'hidden' }); assert.equal(await page.locator('img.opacity-100').count(), 0)
      for (const [testMode, message] of [['empty', 'Aún no hay fotos del avance de obra.'], ['error', 'No se pudo cargar el avance de obra.']]) {
        mode = testMode; await openBoard(); await board.getByText(message, { exact: true }).waitFor(); assert.equal(await board.locator('img').count(), 0); await close()
      }
      mode = 'video'; await openBoard(); await board.locator('video').waitFor(); assert.equal(await board.locator('img').count(), 0); assert.equal(await board.getByText('Aún no hay fotos del avance de obra.').count(), 0); await close()
      assert.deepEqual(errors, []); await page.close(); console.log('PASS construction grid, exact photo, return flow, states and video-only', width)
    }
  } finally { await browser.close(); server.close() }
  console.log('Screenshots:', dir)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
