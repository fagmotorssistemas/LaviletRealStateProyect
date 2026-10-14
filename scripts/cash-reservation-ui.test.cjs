/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http')
const esbuild=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..')
const chrome=[process.env.PLAYWRIGHT_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&require('node:fs').existsSync(p))
test('cash editor saves approved conditions and urgent reservation modal requires a persisted acknowledgement',async()=>{
 const dir=path.join(root,'tmp','cash-reservation-ui');await fs.mkdir(dir,{recursive:true})
 const contents=`import React from 'react';import {createRoot} from 'react-dom/client';import {CashPaymentSettings} from './src/components/inmobiliaria/automation/CashPaymentSettings';import {UrgentReservationAlert} from './src/components/layout/UrgentReservationAlert';import {defaultCashPaymentRules} from './src/lib/inmobiliaria/cashPaymentRules';window.__state={settings:defaultCashPaymentRules(),version:'v1',saved:false};window.__items=[];window.__fail=false;const root=createRoot(document.getElementById('app'));root.render(<CashPaymentSettings initial={{ok:true,state:window.__state}}/>);window.__alert=()=>{window.__items=[{id:'n1',recipient_id:'advisor',kind:'reservation_requested',title:'Solicitud de reserva',body:'Carlos solicitó reservar la unidad 502.',created_at:'2026-10-14T00:00:00Z',read_at:null,metadata:{kommo_id:4454162}}];root.render(<UrgentReservationAlert/>);};`
 await esbuild.build({stdin:{contents,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(dir,'app.js'),platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-app',setup(b){
  const mocks={
   '@/contexts/AuthContext':"export const useAuth=()=>({user:{id:'advisor'},supabase:{}});",
   '@/contexts/AdvisorNotificationsContext':"export const useAdvisorNotifications=()=>({items:window.__items,ready:true,reload:async()=>{}});",
   '@/services/advisorNotifications.service':"export async function markAdvisorNotificationRead(_,recipient,id){if(window.__fail)throw Error('offline');window.__items=window.__items.map(n=>n.id===id&&n.recipient_id===recipient?{...n,read_at:'read'}:n);}",
   '@/app/inmobiliaria/automatizacion/contado/actions':"export const loadCashPaymentRules=async()=>({ok:true,state:window.__state});export async function saveCashPaymentRules(settings,version){window.__state={settings,version:'v2',saved:true};return {ok:true,state:window.__state};}",
   './AutomationSettings':"export const automationSettingsStyles={shell:'shell'};export function AutomationSettingsHeader({title}){return <h1>{title}</h1>}",
   'next/link':"export default function Link({children,...props}){return <a {...props}>{children}</a>}",
  }
  b.onResolve({filter:/.*/},a=>{
   if(a.path in mocks)return {path:a.path,namespace:'mock'}
   if(a.path.startsWith('@/')){const base=path.join(root,'src',a.path.slice(2)),resolved=[base,base+'.ts',base+'.tsx'].find(p=>require('node:fs').existsSync(p));return resolved?{path:resolved}:undefined}
  })
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}))
 }}]})
 const server=http.createServer(async(req,res)=>{try{if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('content-type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(dir,req.url.slice(1))))}else{res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{font:16px sans-serif;padding:16px}dialog{padding:24px;max-width:calc(100vw - 48px)}dialog::backdrop{background:#0008}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>')}}catch{res.statusCode=404;res.end()}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
 try{browser=await chromium.launch({headless:true,...(chrome?{executablePath:chrome}:{})});const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('checkbox',{name:'Permitir que el bot comunique estas condiciones'}).check()
  await page.getByLabel('Qué considera el proyecto un pago al contado').fill('Pago con fondos propios.')
  await page.getByLabel('Documento o responsable que las autoriza').fill('Responsable comercial')
  await page.getByLabel('Verificado el',{exact:true}).fill('2026-10-14')
  await page.getByRole('button',{name:'Guardar reglas de contado'}).click();await page.getByText('Condiciones guardadas para las siguientes respuestas del bot.').waitFor()
  assert.equal((await page.evaluate(()=>window.__state.settings)).definition,'Pago con fondos propios.')
  await page.screenshot({path:path.join(dir,'cash-desktop.png'),fullPage:true})
  await page.setViewportSize({width:390,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:path.join(dir,'cash-mobile.png'),fullPage:true})
  await page.evaluate(()=>window.__alert());const alert=page.getByRole('alertdialog');await alert.waitFor();assert.match(await alert.innerText(),/Carlos.*502/)
  await page.keyboard.press('Escape');assert.equal(await alert.isVisible(),true)
  await page.mouse.click(2,2);assert.equal(await alert.isVisible(),true)
  assert.equal(await page.getByRole('link',{name:'Abrir lead en Kommo'}).getAttribute('target'),'_blank')
  await page.evaluate(()=>window.__fail=true);await page.getByRole('button',{name:'Entendido',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await alert.isVisible(),true)
  await page.screenshot({path:path.join(dir,'urgent-mobile.png'),fullPage:true})
  await page.evaluate(()=>window.__fail=false);await page.getByRole('button',{name:'Entendido',exact:true}).click();await alert.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.__items[0].read_at),'read');assert.deepEqual(errors,[])
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
})
