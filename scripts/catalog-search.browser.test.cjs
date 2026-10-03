// Isolated switch interaction/layout test: no credentials or real mutations.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const http = require('node:http'), assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { webpack } = require('next/dist/compiled/webpack/webpack')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-search-ui-'))

async function main() {
  const loader = path.join(dir, 'ts-loader.cjs'), cssLoader = path.join(dir, 'css-loader.cjs'), entry = path.join(dir, 'entry.tsx')
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
  fs.writeFileSync(cssLoader, `module.exports=function(source){const classes={};source=source.replace(/\\.([A-Za-z_][\\w-]*)/g,(_,name)=>'.'+(classes[name]='catalog_'+name));return 'const style=document.createElement("style");style.textContent='+JSON.stringify(source)+';document.head.appendChild(style);export default '+JSON.stringify(classes)}`)
  const component = path.join(root, 'src/components/inmobiliaria/automation/CatalogSearchControl').replace(/\\/g, '/')
  fs.writeFileSync(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CatalogSearchControl}from'${component}';
    function App(){const[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');return <CatalogSearchControl enabled={enabled} busy={busy} error={error} notice="" onToggle={()=>{setBusy(true);setError('');setTimeout(()=>{if(window.failSave)setError('No se pudo guardar.');else setEnabled(!enabled);setBusy(false)},200)}}/>}createRoot(document.getElementById('root')).render(<App/>);`)
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry,
    output: { path: dir, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules')] },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }, { test: /\.css$/, use: cssLoader }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : resolve()))
  const server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(dir, 'bundle.js'))); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font-family:Arial;margin:20px;background:#f6f8f3}button{font:inherit}</style><h1>Conocimiento y reglas</h1><div id="root"></div><script src="/bundle.js"></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined })
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      const toggle = page.getByRole('switch', { name: 'Búsqueda por embeddings' })
      await toggle.waitFor()
      assert.equal(await toggle.getAttribute('aria-checked'), 'false')
      await toggle.click()
      await page.waitForFunction(() => document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true')
      await toggle.click()
      await page.waitForFunction(() => document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false')
      await page.evaluate(() => { window.failSave = true })
      await toggle.click()
      await page.getByRole('alert').waitFor()
      assert.equal(await toggle.getAttribute('aria-checked'), 'false')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(dir, `switch-${width}.png`), fullPage: true })
      await page.close()
    }
    console.log(JSON.stringify({ result: 'passed', widths: [1280, 390], checks: ['on', 'off', 'save failure', 'no overflow'], screenshots: dir }))
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
