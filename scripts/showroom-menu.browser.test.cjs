// Isolated browser verification. Synthetic inventory; all external requests blocked.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict')
const {chromium}=require('playwright'),{webpack}=require('next/dist/compiled/webpack/webpack'),{compile}=require('@tailwindcss/node')
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'showroom-menu-'))
async function main(){
 const entry=path.join(dir,'entry.tsx'),loader=path.join(dir,'loader.cjs')
 fs.writeFileSync(loader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}`)
 fs.writeFileSync(entry,`
 import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
 import {ShowroomMenu} from '${path.join(root,'src/components/tour/ShowroomMenu').replace(/\\/g,'/')}';
 import {TourLocaleProvider} from '${path.join(root,'src/lib/tour/tourLocale').replace(/\\/g,'/')}';
 const units=[{id:'a',unit_number:'201',category:'departamento',floor:'2',bedrooms:2,area_total_m2:80,status:'disponible',typology_code:'A'}, {id:'b',unit_number:'302',category:'departamento',floor:'3',bedrooms:3,area_total_m2:110,status:'reservado',typology_code:'B'},{id:'c',unit_number:'LC-01',category:'local',floor:'0',area_total_m2:50,status:'disponible'}];
 function App(){const root=useRef(null),[selected,setSelected]=useState(units[0]);return <div ref={root} style={{position:'fixed',inset:0,background:'#29251e'}}><ShowroomMenu root={root} units={units} selected={selected} catalog={{typologies:[{code:'A',rooms:[{url:'/pano'}]}]}} onPick={u=>{window.__picked=u.id;setSelected(u)}} onTour={u=>{window.__tour=u.id;setSelected(u)}} onHome={()=>window.__home=true} onClosePanels={()=>{}}/></div>};createRoot(document.getElementById('root')).render(<TourLocaleProvider><App/></TourLocaleProvider>);
 `)
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,plugins:[new (require('next/dist/compiled/webpack/webpack').webpack.DefinePlugin)({'process.env.NEXT_PUBLIC_WHATSAPP':JSON.stringify(''),'process.env.NEXT_PUBLIC_COOKIE_BANNER_ENABLED':JSON.stringify('true'),'process.env.NEXT_PUBLIC_META_PIXEL_ID':JSON.stringify(''),'process.env.NEXT_PUBLIC_META_PIXEL_SIMULATE':JSON.stringify('true')})],entry,output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules')],alias:{'@':path.join(root,'src')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}},(e,s)=>e?reject(e):s.hasErrors()?reject(Error(s.toString({all:false,errors:true}))):resolve()))
 const source=fs.readFileSync(path.join(root,'src/components/tour/ShowroomMenu.tsx'),'utf8')
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency(){}})).build(source.split(/[\s"'`]+/))
 const server=http.createServer((req,res)=>{if(req.url==='/api/tour/amenities'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:[{amenity_name:'Instalación de prueba',description:'Dato simulado'}]}));return}res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(dir,'bundle.js')):`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`)})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true})
 try{for(const width of [1440,768,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>{errors.push(e.message);console.error('UI_ERROR',e.message)});page.setDefaultTimeout(10000)
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort())
  await page.goto('http://127.0.0.1:'+server.address().port)
  const open=()=>page.getByRole('button',{name:'Abrir menú del showroom'}).click()
  await open();assert.ok((await page.getByRole('dialog').boundingBox()).width<=320);await page.screenshot({path:path.join(root,'docs',`showroom-navigation-${width}.png`)});await page.getByRole('button',{name:'Buscar departamentos',exact:true}).click()
  assert.equal(await page.locator('li').count(),2)
  await page.getByLabel('Piso',{exact:true}).selectOption('2');assert.equal(await page.locator('li').count(),1)
  await page.getByRole('button',{name:'Abrir ficha',exact:true}).click();assert.equal(await page.evaluate(()=>window.__picked),'a')
  await open();await page.getByRole('button',{name:'Locales comerciales',exact:true}).click();assert.equal(await page.locator('li').count(),1)
  await page.getByRole('button',{name:'QR',exact:true}).click();await page.getByAltText('QR LC-01').waitFor()
  assert.equal(await page.locator('a[href*="unidad=LC-01"]').getAttribute('href'),'https://www.lavilett.com/tour?unidad=LC-01')
  await page.getByLabel('Idioma / Language').selectOption('en');assert.equal(await page.getByRole('heading',{name:'Commercial units',exact:true}).count(),1)
  assert.equal(await page.locator('li').count(),1);assert.equal(await page.evaluate(()=>window.__picked),'a')
  await page.getByLabel('Idioma / Language').selectOption('es');await page.getByRole('button',{name:'Volver al menú',exact:true}).click();await page.getByRole('button',{name:'Departamento modelo / 360°',exact:true}).click()
  await page.locator('li').filter({hasText:'Unidad 302'}).getByRole('button',{name:'360°',exact:true}).click();await page.getByRole('status').filter({hasText:'no tiene recorrido'}).waitFor()
  await page.locator('li').filter({hasText:'Unidad 201'}).getByRole('button',{name:'360°',exact:true}).click();assert.equal(await page.evaluate(()=>window.__tour),'a')
  await open();await page.getByRole('button',{name:'Amenidades',exact:true}).click();await page.getByRole('heading',{name:'Instalación de prueba'}).waitFor()
  await page.getByRole('button',{name:'Volver al menú',exact:true}).click();await page.getByRole('button',{name:'Avance de obra',exact:true}).click();assert.match(await page.getByRole('dialog').innerText(),/registro de obra/)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.getByRole('button',{name:'Volver al menú',exact:true}).click();await page.getByRole('button',{name:'Buscar departamentos',exact:true}).click()
  await page.screenshot({path:path.join(root,'docs',`showroom-menu-${width}.png`)})
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0)
  assert.deepEqual(errors,[]);await context.close();console.log('PASS simulated showroom menu '+width)
 }}finally{await browser.close();server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
