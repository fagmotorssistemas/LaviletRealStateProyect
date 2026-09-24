// Actual showroom components; synthetic inventory and blocked external requests.
// This does not validate a real microphone, translated media, or production data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict')
const {chromium}=require('playwright'),{webpack}=require('next/dist/compiled/webpack/webpack'),{compile}=require('@tailwindcss/node')
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'showroom-language-'))
const local=file=>path.join(root,file).replace(/\\/g,'/')
async function main(){
 const entry=path.join(dir,'entry.tsx'),loader=path.join(dir,'loader.cjs'),empty=path.join(dir,'empty.cjs')
 fs.writeFileSync(loader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`)
 fs.writeFileSync(empty,'module.exports=()=>""')
 fs.writeFileSync(entry,`
 import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
 import {TourLocaleProvider,useTourLanguage} from '${local('src/lib/tour/tourLocale')}';
 import {ShowroomMenu} from '${local('src/components/tour/ShowroomMenu')}';
 import {TourFichaDrawer} from '${local('src/components/tour/TourFichaDrawer')}';
 import {Disclaimer} from '${local('src/components/financing/Disclaimer')}';
 import {writeUnitQueryParam} from '${local('src/lib/tour/unitDeepLink')}';
 const units=[{id:'a',unit_number:'001',category:'departamento',floor:'Planta Baja',bedrooms:1,bathrooms:1,area_total_m2:87.97,published_commercial_price:210000,status:'disponible',typology_code:'A'}, {id:'b',unit_number:'002',category:'departamento',floor:'1',bedrooms:2,bathrooms:2,area_total_m2:95,published_commercial_price:250000,status:'reservado',typology_code:'A'}];
 function App(){const root=useRef(null),{locale}=useTourLanguage(),[selected,setSelected]=useState(units.find(u=>u.unit_number===new URL(location.href).searchParams.get('unidad'))||units[0]),[expanded,setExpanded]=useState(false);
 const pick=u=>{setSelected(u);writeUnitQueryParam(u.unit_number)};
 return <div ref={root} lang={locale} data-testid="showroom" style={{position:'fixed',inset:0,background:'#29251e'}}>
 <ShowroomMenu root={root} units={units} selected={selected} catalog={null} onPick={pick} onTour={pick} onHome={()=>{}} onClosePanels={()=>{}}/>
 <TourFichaDrawer open contained expanded={expanded} typologyCode="A" units={units} initialUnitId={selected.id} onSelectUnit={pick} onClose={()=>{}} onVerFicha={()=>setExpanded(true)} onTour360={()=>{}} onRequestInfo={()=>{}}/>
 <div data-testid="disclaimer" style={{position:'absolute',bottom:0,right:0,width:150}}><Disclaimer/></div>
 <output data-testid="selection" style={{display:'none'}}>{selected.id}</output></div>}
 createRoot(document.getElementById('root')).render(<TourLocaleProvider><App/></TourLocaleProvider>);
 `)
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,plugins:[new webpack.DefinePlugin({'process.env':'{}'})],entry,output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules')],alias:{'@':path.join(root,'src')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader},{test:/\.css$/,use:empty}]}},(e,s)=>e?reject(e):s.hasErrors()?reject(Error(s.toString({all:false,errors:true}))):resolve()))
 const files=['ShowroomMenu','TourFichaDrawer','UnitPublicQr'].map(f=>local('src/components/tour/'+f+'.tsx'))
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency(){}})).build(files.flatMap(f=>fs.readFileSync(f,'utf8').split(/[\s"'`]+/)))+fs.readFileSync(local('src/components/tour/tour-viewer.css'),'utf8')
 const server=http.createServer((req,res)=>{const js=req.url.endsWith('.js');res.setHeader('Content-Type',js?'text/javascript':'text/html; charset=utf-8');res.end(js?fs.readFileSync(path.join(dir,req.url.slice(1))):`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`)})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch()
 try{for(const width of [1440,768,390,320]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[]
  page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER_ERROR',e.message)});page.setDefaultTimeout(10000)
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort())
  await page.goto('http://127.0.0.1:'+server.address().port+'/?unidad=001#view')
  await page.getByRole('button',{name:'Abrir menú del showroom'}).click()
  await page.getByRole('button',{name:'Buscar departamentos',exact:true}).click()
  await page.getByLabel('Número de unidad',{exact:true}).fill('002')
  await page.getByLabel('Idioma / Language').selectOption('en')
  assert.equal(await page.getByLabel('Unit number',{exact:true}).inputValue(),'002')
  assert.equal(await page.locator('li').count(),1)
  assert.match(await page.locator('li').innerText(),/Reserved/)
  assert.equal(await page.getByTestId('selection').textContent(),'a')
  assert.equal(new URL(page.url()).searchParams.get('unidad'),'001');assert.equal(new URL(page.url()).hash,'#view')
  await page.getByRole('button',{name:'Open details',exact:true}).click()
  assert.equal(await page.getByTestId('selection').textContent(),'b')
  const ficha=page.getByRole('dialog',{name:'Unit details',exact:true})
  assert.match(await ficha.innerText(),/Bedrooms/);assert.match(await ficha.innerText(),/Reserved/)
  assert.doesNotMatch(await ficha.innerText(),/Dormitorios|Solicitar información/)
  await page.getByRole('button',{name:'View details',exact:true}).click()
  await page.getByRole('button',{name:'Download PDF',exact:true}).waitFor()
  await page.getByRole('button',{name:'Share tour · QR',exact:true}).click()
  const publicLink=page.getByRole('link',{name:/^Open public unit link/})
  assert.match(await publicLink.getAttribute('href'),/unidad=002.*lang=en/)
  assert.match(await page.getByTestId('disclaimer').innerText(),/educational estimates/)
  assert.equal(await page.getByTestId('showroom').getAttribute('lang'),'en')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.reload();await page.getByRole('button',{name:'Open showroom menu'}).waitFor()
  assert.equal(await page.getByTestId('selection').textContent(),'b')
  await page.getByRole('button',{name:'Open showroom menu'}).click();await page.getByLabel('Idioma / Language').selectOption('es')
  await page.getByRole('button',{name:'Cerrar menú'}).click()
  assert.match(await page.getByRole('dialog',{name:'Ficha técnica',exact:true}).innerText(),/Dormitorios/)
  assert.equal(await page.getByTestId('selection').textContent(),'b')
  assert.deepEqual(errors,[])
  await page.screenshot({path:path.join(dir,'showroom-language-'+width+'.png')});await page.close();console.log('PASS ES/EN/ES, details, filters, QR, persistence, shared UI '+width)
 }}finally{await browser.close();server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
