// Simulated UI only: no credentials, original Kommo history, remote DB or Meta calls.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict')
const {chromium}=require('playwright'),{webpack}=require('next/dist/compiled/webpack/webpack'),{compile}=require('@tailwindcss/node')
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'advertising-panel-'))
async function main(){
 const mock=path.join(dir,'mock.js'),entry=path.join(dir,'entry.tsx')
 fs.writeFileSync(mock,`
 const router={refresh(){window.__refreshCount=(window.__refreshCount||0)+1;if(window.__update)window.__update()},push(url){window.__navigation=url}};
 export const useRouter=()=>router;
 export const LeadDetailModal=props=>{if(props.isOpen)window.__openedLead=props.leadId;return null};
 export const listTeamProfilesAction=async()=>[];
 export const listFunnelLeadDetails=async input=>{window.__requestedIds=input.leadIds;return {ok:true,rows:input.leadIds.map(id=>({id,name:'Persona '+id}))}};
 export const UnitNumberSearchInput=()=>null;
 export const assignPromotedUnitAction=async()=>({ok:true,id:'test'});
 export const listPromotedPropertyHistoryAction=async()=>({ok:true,rows:[]});
 `)
 fs.writeFileSync(entry,`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {MarketingFunnelMetricsView} from '${path.join(root,'src/components/inmobiliaria/marketing/MarketingFunnelMetricsView').replace(/\\/g,'/')}';
 const flags={responseRecorded:false,noResponse:false,teamPending:null};
 const people=[{leadId:'p1',name:'Persona p1',adId:'a',kommoId:100,kommoUrl:'https://lavilet.kommo.com/leads/detail/100',historyComplete:true,flags:{...flags,responseRecorded:true,teamPending:true},responses:[{id:'audio1',at:'2026-09-22T12:00:00Z',author:'bot',type:'audio',delivery:'confirmada'},{id:'reply1',at:'2026-09-22T12:05:00Z',author:'asesor',type:'texto',delivery:'confirmada'}]},
 {leadId:'p2',name:'Persona p2',adId:'a',historyComplete:true,flags:{...flags,noResponse:true},responses:[]},
 {leadId:'p3',name:'Persona p3',adId:'b',historyComplete:false,flags, responses:[]},
 {leadId:'p4',name:'Persona p4',adId:'d',historyComplete:false,flags,responses:[]}];
 const ad=(id,campaignId,campaignName,adName,spend,ids)=>({adId:id,attributionKey:id,campaignId,campaignName,adName,adSpend:spend,currency:'USD',leadIds:ids,leadsUnique:ids.length,spendStale:false,spendFetchedAt:'2026-09-23T12:00:00Z',promotedUnit:{label:'Propiedad externa',kind:'single',group:'external',links:[]},metaReportedResults:10,metaResultLabel:'Clics (Meta)'});
 const initial={tenantId:'test',projectId:'test',period:{from:'2026-09-01',to:'2026-09-23'},byAttributedAd:[ad('a','one','Campaña principal','Vista al parque',20,['p1','p2']),ad('b','one','Campaña principal','Visita al proyecto',80,['p3']),ad('c','external','Casa De Tarqui','Casa familiar',50,[]),ad('d',null,null,'Anuncio sin campaña',10,['p4']),...Array.from({length:5},(_,i)=>ad('extra'+i,'extra'+i,'Campaña adicional '+i,'Anuncio adicional '+i,10,[])),ad('',null,null,'Sin origen publicitario',999,['organic'])],
 interestByLead:{p1:{bucket:'caliente',evaluatedAt:'2026-09-22T12:00:00Z',reason:'Pidió una visita',score:60},p2:{bucket:'frio',evaluatedAt:'2026-09-22T12:00:00Z',reason:'Evaluado sin nuevas señales',score:0},p3:{bucket:'caliente',evaluatedAt:'2026-09-22T12:00:00Z',reason:'Preguntó por financiamiento',score:60}},
 attention:{people,asOf:'2026-09-23T12:30:00Z',lastMessageSyncAt:'2026-09-23T12:00:00Z',lastInboundSyncAt:'2026-09-23T12:00:00Z',lastOutboundSyncAt:null,limitations:['El historial original todavía no se ha contrastado.']},adsAccountTimezone:'America/Guayaquil',adsCatalog:{status:'success'},adsInsightsCoverage:{insightsFetchedAt:'2026-09-23T12:00:00Z'},limitations:[]};
 function App(){const [report,setReport]=useState(initial);window.__update=()=>{setReport({...initial,byAttributedAd:initial.byAttributedAd.map(row=>row.adId==='b'?{...row,leadIds:['p3','p5']}:row),attention:{...initial.attention,asOf:'2026-09-23T12:31:00Z'}})};return <MarketingFunnelMetricsView report={report} projects={[]} selectedProjectId="test"/>}
 createRoot(document.getElementById('root')).render(<App/>);
 `)
 const aliases={'next/navigation':mock}
 for(const id of ['@/components/inmobiliaria/leads/LeadDetailModal','@/components/inmobiliaria/shared/UnitNumberSearchInput','@/app/inmobiliaria/leads/actions','@/app/inmobiliaria/marketing/metricas/actions'])aliases[id+'$']=mock
 aliases['@']=path.join(root,'src')
 const loader=path.join(root,'scripts/ui-typescript-loader.cjs')
 // Reuse the repository's lightweight TS loader used by its browser harnesses.
 const availableLoader=fs.existsSync(loader)?loader:path.join(dir,'loader.cjs')
 if(availableLoader!==loader)fs.writeFileSync(availableLoader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}`)
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry,output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules')],alias:aliases},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:availableLoader}]}},(e,s)=>e?reject(e):s.hasErrors()?reject(Error(s.toString({all:false,errors:true}))):resolve()))
 const sources=['AdvertisingMetricsPanel.tsx','AccessibleMetricHelp.tsx'].map(f=>fs.readFileSync(path.join(root,'src/components/inmobiliaria/marketing',f),'utf8')).join(' ')
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency(){}})).build(sources.split(/[\s"'`]+/))
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(dir,'bundle.js')):`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div style="max-width:1600px;padding:16px;margin:auto" id="root"></div><script src="/bundle.js"></script>`)})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const browser=await chromium.launch({headless:true})
 try{for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort())
  await page.goto('http://127.0.0.1:'+server.address().port)
  await page.getByRole('heading',{name:'Métricas embudo',exact:true}).waitFor()
  const cards=page.getByRole('region',{name:'Indicadores publicitarios'}),table=page.getByRole('table')
  assert.equal(await cards.locator('article').count(),6)
  assert.equal(await page.getByRole('table').count(),1)
  assert.match(await table.locator('tfoot').innerText(),/210[,.]00/);assert.match(await table.locator('tfoot').innerText(),/52[,.]50/)
  assert.match(await cards.innerText(),/210[,.]00/)
  await page.getByRole('button',{name:/^Campaña principal/}).click()
  assert.equal(await page.locator('tr[data-ad]').count(),2)
  assert.match(await page.locator('tr[data-campaign="one"]').innerText(),/100[,.]00/)
  await cards.getByRole('button',{name:'Calientes de todos los resultados: 2',exact:true}).click()
  const drawer=page.getByRole('dialog',{name:'Contactos del indicador'})
  await drawer.getByText('Persona p1',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(()=>window.__requestedIds),['p1','p3'])
  assert.match(await drawer.innerText(),/audio/);assert.match(await drawer.innerText(),/Asesor/);assert.match(await drawer.innerText(),/nueva atención pendiente/)
  assert.equal(await drawer.getByRole('link',{name:'Abrir Kommo'}).getAttribute('href'),'https://lavilet.kommo.com/leads/detail/100')
  await drawer.getByLabel('Filtrar atención del detalle').selectOption('responded');assert.equal(await drawer.locator('[data-person]').count(),1)
  await drawer.getByLabel('Filtrar atención del detalle').selectOption('verify');assert.deepEqual(await drawer.locator('[data-person]').evaluateAll(nodes=>nodes.map(n=>n.dataset.person)),['p3'])
  await drawer.getByLabel('Filtrar atención del detalle').selectOption('unanswered');assert.equal(await drawer.locator('[data-person]').count(),0)
  await drawer.getByRole('button',{name:'Cerrar contactos'}).click()
  await page.getByRole('combobox',{name:'Campañas por página'}).selectOption('5')
  assert.equal(await page.locator('tr[data-campaign]').count(),5)
  const totalBefore=await table.locator('tfoot').innerText()
  await page.getByRole('button',{name:'Siguiente',exact:true}).click()
  assert.equal(await page.locator('tr[data-campaign]').count(),3);assert.equal(await table.locator('tfoot').innerText(),totalBefore)
  await page.getByRole('combobox',{name:'Campaña',exact:true}).selectOption('one')
  assert.equal(await page.getByRole('combobox',{name:'Anuncio',exact:true}).locator('option').count(),3)
  await page.getByRole('combobox',{name:'Anuncio',exact:true}).selectOption('b')
  assert.match(await table.locator('tfoot').innerText(),/80[,.]00/)
  assert.equal(await cards.getByRole('button',{name:'Contactos nuevos de todos los resultados: 1',exact:true}).count(),1)
  await page.getByRole('combobox',{name:'Campaña',exact:true}).selectOption('external')
  assert.equal(await page.getByRole('combobox',{name:'Anuncio',exact:true}).inputValue(),'')
  assert.match(await table.innerText(),/Casa De Tarqui/);assert.match(await cards.innerText(),/Sin contactos nuevos/)
  await page.getByRole('button',{name:'Limpiar',exact:true}).click()
  await page.getByRole('searchbox').fill('Anuncio sin campaña')
  assert.match(await table.innerText(),/Campaña pendiente de identificar/)
  assert.match(await cards.innerText(),/0 comprobados/)
  assert.match(await cards.innerText(),/1 por comprobar/)
  await cards.getByRole('button',{name:'1 por comprobar de todos los resultados: Por verificar',exact:true}).first().click()
  await drawer.getByText('Persona p4',{exact:true}).waitFor()
  assert.deepEqual(await drawer.locator('[data-person]').evaluateAll(nodes=>nodes.map(n=>n.dataset.person)),['p4'])
  await drawer.getByRole('button',{name:'Cerrar contactos'}).click()
  await cards.getByRole('button',{name:'Respondidos de todos los resultados: 0',exact:true}).click()
  assert.equal(await drawer.locator('[data-person]').count(),0)
  await drawer.getByRole('button',{name:'Cerrar contactos'}).click()
  await page.getByRole('searchbox').fill('nombre inexistente');assert.match(await table.innerText(),/No hay campañas/)
  await page.getByRole('button',{name:'Limpiar',exact:true}).click()
  const help=cards.getByRole('button',{name:'Explicación: Costo promedio por contacto',exact:true})
  if(mobile)await help.tap();else await help.hover()
  await page.getByRole('dialog',{name:'Explicación: Costo promedio por contacto'}).waitFor()
  assert.match(await page.getByRole('dialog').innerText(),/dividido/)
  await page.getByRole('button',{name:'Cerrar explicación'}).click();await help.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})
  await page.getByLabel('Desde',{exact:true}).fill('2026-09-02');await page.getByRole('button',{name:'Aplicar fechas',exact:true}).click();assert.match(await page.evaluate(()=>window.__navigation),/from=2026-09-02/)
  const syncBefore=await page.getByText(/^Última sincronización registrada:/).innerText()
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await cards.getByRole('button',{name:'Contactos nuevos de todos los resultados: 5',exact:true}).waitFor()
  assert.equal(await page.getByText(/^Última sincronización registrada:/).innerText(),syncBefore)
  assert.match(await table.locator('tfoot').innerText(),/42[,.]00/)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Only the table scrolls horizontally')
  const out=path.join(root,'tmp');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,mobile?'advertising-panel-mobile.png':'advertising-panel-desktop.png'),fullPage:true})
  assert.deepEqual(errors,[])
  console.log((mobile?'Mobile':'Desktop')+': six cards, dependent filters, campaigns/ads/totals, exact people, attention filter, pagination, incomplete data, accessible help and simulated refresh passed')
  await context.close()
 }}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir)})
