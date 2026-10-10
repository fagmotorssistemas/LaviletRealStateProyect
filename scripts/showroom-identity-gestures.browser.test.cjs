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

async function main() {
  const entry = path.join(dir, 'entry.tsx')
  const loader = path.join(dir, 'loader.cjs')
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
  fs.writeFileSync(entry, `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {TourFloorPlan} from '${root.replace(/\\/g,'/')}/src/components/tour/TourFloorPlan';import {TourInfoRequestModal} from '${root.replace(/\\/g,'/')}/src/components/tour/TourInfoRequestModal';function App(){const [open,setOpen]=useState(true);const info=location.pathname==='/info';return <div className="tour-root" style={{position:'fixed',inset:0}}>{info?<TourInfoRequestModal open={open} onClose={()=>setOpen(false)} typologyCode="1A"/>:<TourFloorPlan units={[{id:'unit-101',unit_number:'101',floor:1,status:'disponible',typology_code:'1A'}]} floor={1} onFloorChange={()=>{}} selectedUnitId={null} onSelectUnit={()=>{window.selections=(window.selections||0)+1}} preferredVariant="2d"/>}</div>}createRoot(document.getElementById('root')).render(<App/>);`)
  await new Promise((resolve, reject) => webpack({
    mode: 'development', devtool: false, entry, plugins:[new webpack.DefinePlugin({'process.env.NODE_ENV':JSON.stringify('development'),'process.env':JSON.stringify({})})],
    output: { path: dir, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules')], alias: { '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : resolve()))

  const sources = ['TourFloorPlan.tsx','TourInfoRequestModal.tsx'].map(f=>fs.readFileSync(path.join(root,'src/components/tour',f),'utf8')).join(' ')
  const css = (await compile('@import "tailwindcss";', {base:root,onDependency(){}})).build(sources.split(/[\s"'`]+/)) + fs.readFileSync(path.join(root,'src/components/tour/tour-viewer.css'),'utf8')
  const media={imageUrl:'/photo.svg',imageWidth:1000,imageHeight:700}
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/api/tour/floor-plans')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({doc:{floor:1,typologyCode:'building',...media,variants:{'2d':media,'3d':media},zones:[{id:'101',label:'101',order:0,polygon:[],pointsPercent:'30,30 70,30 70,70 30,70'}],updatedAt:'2026-10-10'}}))}
    if(req.url==='/photo.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="100%" height="100%" fill="#aaa"/></svg>')}
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(dir,'bundle.js')))}
    if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end('{}')}
    res.setHeader('Content-Type','text/html');res.end('<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script src="/bundle.js"></script></html>')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const url='http://127.0.0.1:'+server.address().port
  const browser=await chromium.launch({channel:'chrome'})
  try{
    for(const [width,height] of [[390,844],[844,390]]){
      const page=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:true})
      page.on('pageerror',e=>console.error('PAGE ERROR',e.message))
      await page.goto(url)
      const pin=page.locator('.tour-unit-pin').first();await pin.waitFor();await page.waitForTimeout(400)
      const send=(type,id,x=180,y=190)=>pin.dispatchEvent(type,{pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:y,bubbles:true})
      await pin.dispatchEvent('mouseover');assert.ok(!(await pin.getAttribute('class')).includes('ring-2'),'touch hover must not mark')
      for(const order of [[1,2],[2,1]]){
        const before=await page.evaluate(()=>window.selections||0)
        await send('pointerdown',1);await send('pointerdown',2,240)
        await send('pointermove',2,280)
        await send('pointerup',order[0]);await send('pointerup',order[1])
        await pin.dispatchEvent('click',{detail:1})
        assert.equal(await page.evaluate(()=>window.selections||0),before,'pinch release/click must not select')
        await send('pointerdown',1);await send('pointerup',1,208)
        assert.equal(await page.evaluate(()=>window.selections||0),before+1,'fresh tap with 28px drift selects')
        await page.waitForTimeout(360)
      }
      const before=await page.evaluate(()=>window.selections||0)
      await send('pointerdown',1);await send('pointerup',1,230);await pin.dispatchEvent('click',{detail:1})
      assert.equal(await page.evaluate(()=>window.selections||0),before,'large drift must not select')
      // Native browser touch dispatch also exercises implicit capture and compatibility clicks.
      await page.waitForTimeout(360)
      const client=await page.context().newCDPSession(page)
      const rect=await pin.boundingBox();const x=rect.x+rect.width/2,y=rect.y+rect.height/2
      const count=await page.evaluate(()=>window.selections||0)
      const point=(id,offset)=>({id,x:x+offset,y,radiusX:2,radiusY:2,force:1})
      await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(1,0)]})
      await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(1,0),point(2,45)]})
      await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(1,0),point(2,65)]})
      await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[point(1,0)]})
      await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      assert.equal(await page.evaluate(()=>window.selections||0),count,'native pinch must not open unit')
      await page.waitForTimeout(360)
      const fresh=await pin.boundingBox();await page.touchscreen.tap(fresh.x+fresh.width/2,fresh.y+fresh.height/2)
      assert.equal(await page.evaluate(()=>window.selections||0),count+1,'native tap after pinch opens unit')
      await page.close();console.log('PASS plan gestures '+width+'x'+height)
    }
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true})
    await page.goto(url+'/info')
    assert.equal(await page.locator('input[name=name]').count(),1)
    await page.evaluate(()=>{localStorage.setItem('lv_showroom_phone','+593999999999');window.dispatchEvent(new Event('lv:showroom-identity'))})
    await page.waitForFunction(()=>!document.querySelector('input[name=name]'))
    assert.equal(await page.locator('input[name=email],input[name=phone]').count(),0)
    let submitted
    await page.route('**/api/tour/lead',route=>{submitted=route.request().postDataJSON();return route.fulfill({json:{lead_id:'existing-test-lead'}})})
    await page.locator('textarea').fill('Consulta de prueba')
    await page.locator('input[name=consent]').check()
    await page.locator('button[type=submit]').click()
    await page.waitForFunction(()=>!document.querySelector('form'))
    assert.equal(submitted.phone,'+593999999999');assert.equal(submitted.mode,'phone');assert.equal(submitted.request_kind,'info_request')
    assert.ok(!submitted.name&&!submitted.email,'do not overwrite saved identity')
    console.log('PASS identified info request uses existing phone; anonymous form retains fields')
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(error=>{console.error(error);process.exitCode=1})
