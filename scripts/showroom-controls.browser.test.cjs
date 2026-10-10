/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS browser harness. */
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const base = process.env.SHOWROOM_URL || 'http://localhost:3000/tour'
const sizes = [[800,700,false],[900,650,false],[375,812,true],[390,844,true],[667,320,true],[740,360,true],[812,375,true],[844,390,true],[932,430,true]]
async function accessible(locator, label) {
  const result = await locator.evaluate(el => {
    const r = el.getBoundingClientRect()
    const points = [[.25,.25],[.75,.25],[.5,.5],[.25,.75],[.75,.75]]
    return { name: el.getAttribute('aria-label') || el.textContent, rect: {x:r.x,y:r.y,w:r.width,h:r.height}, hits: points.map(([x,y]) => {
      const hit = document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)
      return el.contains(hit) ? null : hit?.outerHTML.slice(0,200) || 'fuera de pantalla'
    }) }
  })
  assert.ok(result.hits.every(x=>x===null), label + ': ' + JSON.stringify(result))
  if (!(await locator.isDisabled())) await locator.click({trial:true})
}
async function audit(page,label) {
  const selectors = ['[data-showroom-toolbar] button','[data-showroom-toolbar] a','.tour-plan-variant','.tour-zoom-btn','[data-tour-voice]','.tour-whatsapp-btn','.tour-gallery-arrow']
  const checked=[]
  for (const selector of selectors) for (const el of await page.locator(selector).all()) {
    if (!(await el.isVisible())) continue
    if (!(await el.evaluate(node => {
      if (getComputedStyle(node).pointerEvents === 'none') return false
      for (let el=node;el;el=el.parentElement) if (Number(getComputedStyle(el).opacity) === 0) return false
      return true
    }))) continue
    await accessible(el,label)
    checked.push(await el.getAttribute('aria-label') || await el.innerText())
  }
  console.log('CONTROLS', label, checked.join(', '))
}
async function main(){
 const browser=await chromium.launch()
 try { for(const [width,height,touch] of sizes){
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,reducedMotion:'reduce'})
  const page=await context.newPage();page.setDefaultTimeout(15000)
  await page.route('**/api/tour/event',r=>r.fulfill({json:{ok:true}}))
  await page.route('**/api/tour/voice-assist/speak',r=>r.abort())
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:90000})
  await page.addStyleTag({content:'nextjs-portal { display: none !important; }'})
  await page.locator('[data-showroom-menu]').waitFor()
  await page.waitForTimeout(2000)
  for (const name of ['Aceptar cookies','Cerrar aviso','Ingresar','Saltar']) {
    const button=page.getByRole('button',{name,exact:true})
    if(await button.isVisible().catch(()=>false)) {await button.click();await page.waitForTimeout(name==='Ingresar'?1500:200)}
  }
  const label=width+'x'+height
  await audit(page,label+' plano')
  assert.equal(await page.locator('.tour-floor-rail button').count(),10,label+' pisos')
  assert.equal(await page.locator('.tour-plan-variant').count(),2,label+' 2D/3D')
  for(const floor of await page.locator('.tour-floor-rail button').all()) {
    await floor.scrollIntoViewIfNeeded();await accessible(floor,label+' pisos');await floor.click()
  }
  for(const mode of await page.locator('.tour-plan-variant').all()) if(await mode.isEnabled()) await mode.click()
  await page.locator('[data-showroom-menu]').click()
  await page.getByRole('button',{name:'Buscar departamentos',exact:true}).click()
  await page.getByRole('button',{name:'Abrir ficha',exact:true}).first().click()
  const sheet=page.locator('.tour-ficha-sheet');await sheet.waitFor()
  const expand=sheet.getByRole('button',{name:'Ver Ficha',exact:true});if(await expand.isVisible()) await expand.click()
  await sheet.getByRole('button',{name:'Descargar PDF',exact:true}).waitFor()
  await page.waitForTimeout(300)
  if(height<=500){
    const s=await sheet.boundingBox(),bar=await page.locator('[data-showroom-toolbar]').boundingBox()
    assert.ok(s.y>=bar.y+bar.height+6,label+' ficha no reserva barra: '+JSON.stringify({s,bar}))
  }
  const close=sheet.locator('.tour-ficha-close:visible, .tour-ficha-media-close:visible').first()
  await accessible(close,label+' X');await close.click();await sheet.waitFor({state:'hidden'})
  await page.waitForTimeout(300)
  await audit(page,label+' galeria')
  assert.equal(await page.locator('.tour-gallery-arrow').count(),2,label+' ambas flechas')
  for(const arrow of await page.locator('.tour-gallery-arrow').all()) {await accessible(arrow,label+' galeria');await arrow.click();await page.waitForTimeout(150)}
  await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'showroom-audit-'+label+'.png')})
  await context.close();console.log('PASS',label)
 }}finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
