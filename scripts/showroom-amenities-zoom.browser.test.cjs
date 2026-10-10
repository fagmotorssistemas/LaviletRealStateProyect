/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS browser harness. */
// Exercise the real component with local images of different aspect ratios.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')
const { webpack } = require('next/dist/compiled/webpack/webpack')
const { compile } = require('@tailwindcss/node')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amenities-zoom-'))
const component = 'src/components/tour/TourAmenitiesGallery.tsx'
const photos = [[1600, 900], [600, 1200], [1000, 1000]]

async function main() {
  const entry = path.join(dir, 'entry.tsx')
  const loader = path.join(dir, 'loader.cjs')
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
  fs.writeFileSync(entry, `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {TourAmenitiesGallery} from '${path.join(root, component).replace(/\\/g, '/')}';function App(){const [open,setOpen]=useState(false);return <><button id="toggle" style={{position:"fixed",top:0,left:160,zIndex:300}} onClick={()=>setOpen(!open)}>Toggle</button><div className="tour-root" id="stage" style={{position:'fixed',inset:0}}><TourAmenitiesGallery open={open}/></div></>}createRoot(document.getElementById('root')).render(<App/>);`)
  await new Promise((resolve, reject) => webpack({
    mode: 'development', devtool: false, entry,
    output: { path: dir, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules')], alias: { '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : resolve()))
  const css = (await compile('@import "tailwindcss";', { base: root, onDependency() {} })).build(fs.readFileSync(path.join(root, component), 'utf8').split(/[\s"'`]+/)) + fs.readFileSync(path.join(root, 'src/components/tour/tour-viewer.css'), 'utf8')
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tour/amenities') {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ items: photos.map((_, i) => ({ title: `Foto ${String.fromCharCode(65 + i)}`, titleEn: `Photo ${String.fromCharCode(65 + i)}`, imageUrl: `/photo-${i}.svg` })) }))
    }
    const photo = /^\/photo-(\d)\.svg$/.exec(req.url)
    if (photo) {
      const [w, h] = photos[Number(photo[1])]
      res.setHeader('Content-Type', 'image/svg+xml')
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#648788"/><rect x="4" y="4" width="${w - 8}" height="${h - 8}" stroke="white" stroke-width="8" fill="none"/></svg>`)
    }
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html; charset=utf-8')
    res.end(req.url === '/bundle.js' ? fs.readFileSync(path.join(dir, 'bundle.js')) : `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch()
  try {
    for (const [width, height] of [[390, 844], [844, 390], [800, 700]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true })
      page.setDefaultTimeout(5000)
      await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort())
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.locator('#toggle').click()
      const out = page.getByRole('button', { name: 'Alejar', exact: true })
      const inside = page.getByRole('button', { name: 'Acercar', exact: true })
      const image = () => page.locator('img.opacity-100')
      const geometry = () => image().evaluate(el => {
        const i = el.getBoundingClientRect(), b = el.parentElement.getBoundingClientRect()
        return { x: i.x, y: i.y, w: i.width, h: i.height, bx: b.x, by: b.y, bw: b.width, bh: b.height, ratio: el.naturalWidth / el.naturalHeight }
      })
      const settle = async index => {
        await page.waitForFunction(i => {
          const img = document.querySelector('img.opacity-100')
          return img?.getAttribute('src') === `/photo-${i}.svg` && img.complete && img.naturalWidth > 0
        }, index)
        await page.waitForTimeout(450)
      }
      const contain = async () => {
        for (let n = 0; n < 12 && await out.isEnabled(); n++) await out.click()
        assert.ok(await out.isDisabled(), 'Alejar reaches its lower bound')
        const g = await geometry()
        assert.ok(g.w <= g.bw + 1 && g.h <= g.bh + 1, 'whole image fits within container: ' + JSON.stringify(g))
        assert.ok(Math.abs(g.w - g.bw) < 1 || Math.abs(g.h - g.bh) < 1, 'image touches one pair of edges')
        assert.ok(Math.abs(g.w / g.h - g.ratio) < .002, 'natural aspect ratio preserved')
        assert.ok(Math.abs(g.x + g.w / 2 - g.bx - g.bw / 2) < 1, 'image centered horizontally')
        assert.ok(Math.abs(g.y + g.h / 2 - g.by - g.bh / 2) < 1, 'image centered vertically')
        return g
      }
      for (const index of [0, 1, 2, 0]) {
        await settle(index)
        assert.ok(await out.isEnabled(), 'Alejar available from initial cover')
        assert.ok(await inside.isDisabled(), 'initial zoom is cover')
        const before = await geometry()
        assert.ok(before.w >= before.bw - 1 && before.h >= before.bh - 1, 'initial image covers container')
        await out.click()
        assert.ok((await geometry()).w < before.w - 1, 'Alejar visibly shrinks image')
        const small = await contain()
        await inside.click()
        assert.ok((await geometry()).w > small.w + 1, 'Acercar visibly enlarges image')
        for (let n = 0; n < 12 && await inside.isEnabled(); n++) await inside.click()
        assert.ok(await inside.isDisabled(), 'Acercar reaches cover bound')
        await contain()
        // Next image always starts at cover, including a cached buffer.
        await page.getByRole('button', { name: 'Imagen siguiente' }).click()
      }
      await settle(1)
      await contain()
      await page.setViewportSize({ width: height, height: width })
      await page.waitForTimeout(150)
      await contain()
      await page.locator('#stage').evaluate(el => { el.style.right = '100px' })
      await page.waitForTimeout(150)
      await contain()
      // Pinch uses the same bounds as the buttons.
      const surface = page.locator('#stage > div')
      for (let n = 0; n < 12 && await inside.isEnabled(); n++) await inside.click()
      const large = await geometry()
      await surface.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 160 })
      await surface.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', button: 0, clientX: 300, clientY: 160 })
      await surface.dispatchEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 150, clientY: 160 })
      assert.ok((await geometry()).w < large.w - 1, 'pinch shrinks image')
      await surface.dispatchEvent('pointercancel', { pointerId: 1 })
      await page.locator('#toggle').click()
      await page.locator('#toggle').click()
      await settle(1)
      await contain()
      await page.close()
      console.log(`PASS amenities zoom ${width}x${height}: buttons, ratios, cached changes, resize, pinch, reopen`)
    }
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
