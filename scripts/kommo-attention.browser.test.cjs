/* Isolated browser regression: synthetic evidence, no provider or CRM calls. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict')
const {chromium}=require('playwright'),{webpack}=require('next/dist/compiled/webpack/webpack')
async function main(){
  const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'attention-evidence-ui-'))
  const entry=path.join(dir,'entry.tsx'),loader=path.join(dir,'loader.cjs')
  fs.writeFileSync(loader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText`)
  fs.writeFileSync(entry,`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {evaluateAttention} from '@/services/marketingAttention.logic';
    import {MarketingAttentionSummary} from '@/components/inmobiliaria/marketing/MarketingAttentionSummary';
    const date='2026-09-23T10:00:00Z',after='2026-09-23T10:01:00Z',again='2026-09-23T10:02:00Z';
    const message=(id,role,sent_at,status)=>({id,conversation_id:'c',role,sent_at,provider_status:status,external_message_id:id,media_type:'audio'});
    const person=(id,name,kommo,messages,complete)=>evaluateAttention({lead:{id,name,kommo_id:kommo,contact_id:'999'+kommo,created_at:date,status:'nuevo',temperature:'frio',bot_enabled:false},adId:null,asOf:'2026-09-23T12:00:00Z',conversations:[{id:'c',lead_id:id,started_at:date,last_message_at:messages.at(-1).sent_at,status:'activa'}],messages,tasks:[],appointments:[],purchased:false,coverage:{messages:true,kommo:complete,tasks:true,appointments:true,sales:true}});
    const people=[person('one','Bot con audio',11,[message('i1','cliente',date),message('o1','bot',after,'sent')],false),person('two','Asesor y nueva pregunta',22,[message('i2','cliente',date),message('o2','asesor',after,'sent'),message('i3','cliente',again)],true),person('three','Sin respuesta comprobada',33,[message('i4','cliente',date)],true),person('four','Generado sin envío',44,[message('i5','cliente',date),message('o3','bot',after,'accepted')],false)];
    createRoot(document.getElementById('root')).render(<MarketingAttentionSummary people={people} onOpen={ids=>{window.__ids=ids}} />);
  `)
  await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry,output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules')],alias:{'@':path.join(root,'src')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}},(e,s)=>e?reject(e):s.hasErrors()?reject(Error(s.toString({all:false,errors:true}))):resolve()))
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/bundle.js'?fs.readFileSync(path.join(dir,'bundle.js')):'<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>')})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const browser=await chromium.launch({headless:true})
  try{for(const mobile of [false,true]){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile})
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort())
    await page.goto('http://127.0.0.1:'+server.address().port)
    const responseCard=page.locator('div.rounded-lg').filter({has:page.getByText('Con alguna respuesta enviada',{exact:true})})
    await responseCard.getByRole('button',{name:'2',exact:true}).click()
    assert.deepEqual(await page.evaluate(()=>window.__ids),['one','two'])
    const details=page.getByLabel('Detalle de contactos seleccionados')
    assert.match(await details.innerText(),/Bot con audio/)
    assert.match(await details.innerText(),/audio/)
    assert.equal(await details.getByRole('link',{name:'Ficha comercial Kommo 11',exact:true}).getAttribute('href'),'https://lavilet.kommo.com/leads/detail/11')
    await page.getByRole('button',{name:'Ocultar detalle'}).click()
    const unknown=page.locator('div.rounded-lg').filter({has:page.getByText('Historial incompleto',{exact:true})})
    await unknown.getByRole('button',{name:'2',exact:true}).click()
    assert.deepEqual(await page.evaluate(()=>window.__ids),['one','four'])
    assert.match(await page.getByLabel('Detalle de contactos seleccionados').innerText(),/Generado sin envío/)
    assert.deepEqual(errors,[])
    await context.close()
  }console.log('PASS synthetic desktop/mobile: exact people, name, commercial-file link, multimedia proof, incomplete history separated')}
  finally{await browser.close();await new Promise(r=>server.close(r))}
}
main().catch(e=>{console.error(e);process.exitCode=1})
