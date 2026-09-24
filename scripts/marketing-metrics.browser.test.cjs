// Isolated UI check: no Next server, credentials, database or external requests.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS matches the existing test harnesses. */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { webpack } = require('next/dist/compiled/webpack/webpack')
const { compile } = require('@tailwindcss/node')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-metrics-ui-'))

async function main() {
  const mock = path.join(dir, 'mock.js')
  fs.writeFileSync(mock, `
    // Next refresh preserves client state; a polling refresh must not close dialogs.
    export const useRouter = () => ({ refresh() {if(window.__refreshAfterSave)window.location.reload()} });
    export const LeadDetailModal = props => {if(props.isOpen) window.__openedLead=props.leadId;return null;};
    export const UnitNumberSearchInput = () => null;
    export const listTeamProfilesAction = async () => [];
    export const listFunnelLeadDetails = async input => {window.__drilldownIds=input.leadIds;return {ok:true,rows:input.leadIds.map(id=>({id,name:'Ficha '+id,status:'nuevo',temperature:'frio'}))}};
    // Simulated persistence only: the database routine is tested separately in PGlite.
    export const assignPromotedUnitAction = async input => {localStorage.setItem('property-test',JSON.stringify(input));window.__refreshAfterSave=true;return {ok:true,id:'saved-test'}};
    export const listPromotedPropertyHistoryAction = async () => ({ok:true,rows:[]});
  `)
  const loader = path.join(dir, 'loader.cjs')
  fs.writeFileSync(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText}`)
  const entry = path.join(dir, 'entry.tsx')
  fs.writeFileSync(entry, `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {attentionLabels} from '@/services/marketingAttention.logic';
    import {MarketingFunnelMetricsView} from '@/components/inmobiliaria/marketing/MarketingFunnelMetricsView';
    const temperature={frio:2,tibio:3,caliente:5,sin_clasificar:0};
    const ad={attributionKey:'12345',adId:'12345',adName:'Anuncio de prueba',campaignId:'camp1',campaignName:'Campaña de prueba',resolutionStatus:'resolved',leadsUnique:10,leadIds:Array.from({length:10},(_,i)=>'lead'+i),temperature,adSpend:20,currency:'USD',costPerLead:2,metaReportedResults:15,metaResultActionType:'link_click',metaResultLabel:'Clics en enlace',leadsWithAppointmentRequested:4,leadsWithAppointmentConfirmed:3,leadsWithAppointmentDone:2,salesConfirmed:1,promotedUnit:{label:'Unidad 101',kind:'single',group:'inventory',evidence:'saved',unambiguousUnitId:'u1',links:[{id:'link1',unitId:'u1',unitLabel:'Unidad 101',externalLabel:null}]},spendStale:true};
    const external={...ad,attributionKey:'23456',adId:'23456',adName:'Anuncio externo',adSpend:80,leadsUnique:2,leadIds:['external1','external2'],costPerLead:40,promotedUnit:{label:'Casa de prueba externa',kind:'single',group:'external',evidence:'saved',unambiguousUnitId:null,links:[{id:'link2',unitId:null,unitLabel:'Casa de prueba externa',externalLabel:'Casa de prueba externa'}]}};
    const multiple={...ad,attributionKey:'34567',adId:'34567',adName:'Anuncio múltiple',adSpend:40,leadsUnique:4,leadIds:['multi1','multi2','multi3','multi4'],costPerLead:10,promotedUnit:{label:'Unidad 101 + Unidad 102',kind:'multi',group:'multiple',evidence:'ad_link',unambiguousUnitId:null,links:[{id:'',unitId:'u1',unitLabel:'Unidad 101',externalLabel:null},{id:'',unitId:'u2',unitLabel:'Unidad 102',externalLabel:null}]}};
    const confirmation=JSON.parse(localStorage.getItem('property-test') || 'null');
    const unknown={...ad,attributionKey:'45678',adId:'45678',adName:'Anuncio sin evidencia',adSpend:10,leadsUnique:1,leadIds:['unknown1'],costPerLead:10,promotedUnit:confirmation?{label:confirmation.targets[0].externalLabel,kind:'single',group:'external',evidence:'saved',unambiguousUnitId:null,links:confirmation.targets.map(t=>({...t,id:'saved-test',unitLabel:t.externalLabel}))}:{label:'Propiedad sin identificar',kind:'none',group:'unidentified',evidence:'none',unambiguousUnitId:null,links:[]}};
    const report={tenantId:'test',projectId:'test',period:{from:'2026-09-01',to:'2026-09-23'},totals:{leadsAcquiredInPeriod:10,leadsWithAttribution:8,leadsWithoutAttribution:2,temperature,appointmentsInPeriod:{scheduled:3,completed:2,cancelled:1,noShow:1},salesOccurredInPeriod:1,salesAmountInPeriod:50000,salesCurrency:'USD',contractsCurrentlyAnulled:1},byAttributedAd:[ad],byCampaign:[{...ad,adCount:1,adSpendSum:20,spendCoherent:true}],byPromotedUnit:[{...ad,unitId:'u1',unitLabel:'Unidad 101',adCount:1,adIds:['ad1']}],byUnit:[{unitId:'u1',unitLabel:'Unidad 101',showroomViews:3,commercialInterestLeads:4,appointmentLeads:2,reservedLeads:1,salesConfirmed:1,salesAmount:50000,temperature}],adsInsightsCoverage:{currencyStatus:'live',insightsIncomplete:false},undeterminedUnit:{appointmentLeads:1,reservedLeads:1,note:'legacy technical note'},undeterminedTitularUnits:1};
    const spendOnly={...ad,adId:'56789',attributionKey:'56789',adName:'Anuncio sin contactos',campaignId:'camp2',campaignName:'Campaña pausada con actividad',leadIds:[],leadsUnique:0,costPerLead:null};
    report.byAttributedAd=[ad,external,multiple,unknown,spendOnly];
    report.interestByLead={lead0:{bucket:'tibio',evaluatedAt:'2026-09-22T12:00:00Z',score:25,reason:'Pregunta por precio registrada'},lead1:{bucket:'frio',evaluatedAt:'2026-09-22T12:00:00Z',score:0,reason:'Evaluación sin nuevas señales'}};
    report.attention={asOf:'2026-09-23T12:00:00Z',deadlines:[{project:'test',minutes:120,timezone:'America/Guayaquil'}],limitations:[],people:report.byAttributedAd.flatMap(ad=>ad.leadIds.map((id,i)=>({leadId:id,adId:ad.adId,flags:{...Object.fromEntries(Object.keys(attentionLabels).map(k=>[k,false])),cold:true,noResponse:ad.adId==='12345' && i<2,followupOverdue:ad.adId==='12345' && i===1,anyPending:ad.adId==='12345' && i<2},responses:[],botSeconds:null,advisorSeconds:null,reasons:[],dueAt:null})))};
    report.attention.people.push({leadId:'unknown-origin',adId:null,flags:Object.fromEntries(Object.keys(attentionLabels).map(k=>[k,null])),responses:[],botSeconds:null,advisorSeconds:null,reasons:[],dueAt:null});
    report.adsCatalog={status:'failed',campaigns:[],ads:[],attemptedAt:'2026-09-23T12:00:00Z',successfulAt:'2026-09-22T12:00:00Z'};
    createRoot(document.getElementById('root')).render(<MarketingFunnelMetricsView report={report} projects={[]} selectedProjectId="test" adsProbe={{connected:true,currency:'USD',timezone:'America/Guayaquil'}} />);
  `)
  const aliases = {'next/navigation':mock}
  for(const id of ['@/components/inmobiliaria/leads/LeadDetailModal','@/components/inmobiliaria/shared/UnitNumberSearchInput','@/app/inmobiliaria/leads/actions','@/app/inmobiliaria/marketing/metricas/actions']) aliases[id+'$']=mock
  aliases['@']=path.join(root,'src')
  await new Promise((resolve,reject) => webpack({mode:'development',devtool:false,entry,output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules')],alias:aliases},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}},(err,stats)=>err?reject(err):stats.hasErrors()?reject(Error(stats.toString({all:false,errors:true}))):resolve()))
  const sources=['MarketingFunnelMetricsView.tsx','MarketingCommercialBoard.tsx','AccessibleMetricHelp.tsx','MarketingInterestBreakdown.tsx','PropertyIdentificationDialog.tsx','MarketingAttentionSummary.tsx'].map(f=>fs.readFileSync(path.join(root,'src/components/inmobiliaria/marketing',f),'utf8')).join(' ')
  const css=(await compile('@import "tailwindcss";', {base:root,onDependency(){}})).build(sources.split(/[\s"'`]+/))
  const server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(dir,'bundle.js')))}
    else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><main style="padding:16px"><div id="root"></div></main><script src="/bundle.js"></script></body></html>`)}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  let browser
  try {
    browser=await chromium.launch({headless:true})
    for(const mobile of [false,true]){
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile})
      const page=await context.newPage()
      page.setDefaultTimeout(8000)
      const errors=[]
      page.on('pageerror',e=>errors.push(e.message))
      await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort())
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.getByRole('heading',{name:'Métricas de marketing',exact:true}).waitFor()
      assert.deepEqual(errors,[])
      const helper=page.getByRole('button',{name:'Explicación: Contactos interesados',exact:true}).first()
      if(mobile) await helper.tap(); else await helper.hover()
      await page.getByRole('dialog').waitFor()
      assert.match(await page.getByRole('dialog').innerText(),/fecha de registro/)
      await page.getByRole('button',{name:'Cerrar explicación'}).click()
      await page.getByRole('dialog').waitFor({state:'hidden'})
      await helper.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({state:'hidden'})
      assert.equal(await helper.evaluate(el=>el===document.activeElement),true)
      await page.getByRole('region',{name:'Resumen general de atención',exact:true}).locator('summary').click()
      await page.mouse.move(0,0)
      // Every help control must open non-empty, meaningful content, including table columns.
      const count=await page.getByRole('button',{name:/^Explicación:/}).count()
      assert.ok(count>=40)
      for(let i=0;i<count;i++){
        const button=page.getByRole('button',{name:/^Explicación:/}).nth(i)
        const label=await button.getAttribute('aria-label')
        await button.focus()
        await page.keyboard.press('Enter')
        const dialog=page.getByRole('dialog')
        await dialog.waitFor()
        assert.ok((await dialog.locator('p').innerText()).length>50,label)
        const bounds=await dialog.boundingBox()
        assert.ok(bounds.x>=0 && bounds.x+bounds.width <= (mobile?390:1440)+1,'Help fits viewport')
        await page.keyboard.press('Escape')
        await dialog.waitFor({state:'hidden'})
      }
      const text=await page.locator('body').innerText()
      assert.doesNotMatch(text,/\b(CPL|CTWA|Leads|cohorte|first-touch|stale|Insights|rollup|Temperatura)\b/i)
      assert.match(text,/Clics en enlace \(Meta\): 15/)
      assert.match(text,/No se pudieron consultar las campañas/)
      assert.doesNotMatch(text,/Datos publicitarios actualizados/)
      const attention=page.getByRole('region',{name:'Resumen general de atención',exact:true})
      await page.getByRole('button',{name:'Sin evaluar: 8',exact:true}).click()
      await page.getByRole('dialog',{name:'Contactos del indicador'}).waitFor()
      assert.deepEqual(await page.evaluate(()=>window.__drilldownIds),['lead2','lead3','lead4','lead5','lead6','lead7','lead8','lead9'])
      await page.getByRole('button',{name:'Cerrar',exact:true}).click()
      await attention.getByRole('button',{name:'2 de 17, 11.8 %',exact:true}).first().click()
      await page.getByRole('dialog',{name:'Contactos del indicador'}).waitFor()
      await page.getByText('Ficha lead0',{exact:true}).waitFor()
      assert.deepEqual(await page.evaluate(()=>window.__drilldownIds),['lead0','lead1'])
      await page.getByRole('button',{name:'Abrir ficha',exact:true}).first().click()
      assert.equal(await page.evaluate(()=>window.__openedLead),'lead0')
      await page.locator('summary').filter({hasText:'Atención y avance de Anuncio de prueba'}).click()
      await page.getByRole('region',{name:'Atención y avance',exact:true}).getByText('Ver detalle',{exact:true}).click()
      assert.match(await page.getByRole('region',{name:'Atención y avance',exact:true}).innerText(),/2 de 10, 20 %/)
      await page.locator('summary').filter({hasText:'Atención y avance de Anuncio de prueba'}).click()
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Only tables scroll horizontally')
      assert.match(await page.locator('body').innerText(),/Sin contactos nuevos/)
      const advertising = page.getByRole('region',{name:'Publicidad de la cuenta conectada'})
      assert.match(await advertising.innerText(),/170[,.]00/)
      assert.match(await advertising.innerText(),/10[,.]00/)
      assert.equal(await page.getByRole('group',{name:'Tipo de propiedad'}).count(),0)
      assert.match(await page.locator('body').innerText(),/Casa de prueba externa/)
      assert.match(await page.locator('body').innerText(),/Unidad 101 \+ Unidad 102/)
      assert.match(await page.locator('body').innerText(),/gasto sin repartir/)
      await page.getByRole('button',{name:'Identificar propiedad',exact:true}).click()
      const edit=page.getByRole('dialog',{name:'Identificar propiedad',exact:true})
      await edit.getByLabel('Nombre de propiedad externa').fill('Casa confirmada en prueba')
      await edit.getByRole('button',{name:'Añadir externa'}).click()
      await edit.getByLabel('Cómo confirmó la propiedad o motivo de la corrección').fill('Confirmación simulada del responsable')
      await Promise.all([page.waitForEvent('load'),edit.getByRole('button',{name:'Guardar identificación'}).click()])
      await page.getByText('Casa confirmada en prueba',{exact:true}).waitFor()
      // A stationary mouse can hover a help icon after the page layout reloads.
      await page.mouse.move(0,0)
      await page.keyboard.press('Escape')
      await page.getByRole('button',{name:'Corregir propiedad',exact:true}).first().waitFor()
      assert.equal(await page.getByRole('button',{name:'Corregir propiedad',exact:true}).count(),5)
      console.log('All property types visible in campaign hierarchy; simulated save/reload verified')
      assert.deepEqual(errors,[])
      console.log(`${mobile?'Mobile touch':'Desktop hover'} + keyboard: ${count} explanations verified`)
      await context.close()
    }
  } finally {if(browser) await browser.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
  // Delete only files created in this uniquely allocated temporary directory.
  for(const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir,f))
  fs.rmdirSync(dir)
})
