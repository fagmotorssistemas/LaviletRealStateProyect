const assert = require('node:assert/strict')
const { chromium, webkit, devices } = require('playwright')

const base = process.env.SHOWROOM_URL || 'http://localhost:3000/tour'

async function installAutoplayBlock(page, options = {}) {
  await page.addInitScript((blockPortada) => {
    const proto = HTMLVideoElement.prototype
    const nativePlay = proto.play
    window.__plays = []
    window.__clickDepth = 0
    window.__samples = []
    proto.requestVideoFrameCallback = function () {
      return 0
    }
    proto.cancelVideoFrameCallback = function () {}
    proto.play = function playBlocked() {
      const stack = new Error().stack || ''
      const inClick = window.__clickDepth > 0 || stack.includes('executeDispatch')
      const src = this.currentSrc || this.src || ''
      window.__plays.push({
        inClick,
        src: src.split('?')[0].split('/').slice(-2).join('/'),
      })
      if (!inClick) {
        return Promise.reject(new DOMException('The request is not allowed by the user agent.', 'NotAllowedError'))
      }
      return nativePlay.apply(this, arguments)
    }
    if (blockPortada) {
      const media = HTMLMediaElement.prototype
      const srcDesc = Object.getOwnPropertyDescriptor(media, 'src')
      Object.defineProperty(media, 'src', {
        configurable: true,
        get() {
          return srcDesc.get.call(this)
        },
        set(value) {
          if (String(value).includes('portada')) return
          srcDesc.set.call(this, value)
        },
      })
    }
    document.addEventListener('click', (event) => {
      window.__clickDepth += 1
      const node = event.target && event.target.nodeType === 3 ? event.target.parentElement : event.target
      const button = node && node.closest ? node.closest('button') : null
      window.__lastClick = button ? (button.textContent || '').trim() : ''
      setTimeout(() => {
        window.__clickDepth = Math.max(0, window.__clickDepth - 1)
      }, 0)
    }, true)
    let origin = 0
    setInterval(() => {
      const button = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Ingresar')
      const cover = [...document.querySelectorAll('video')].find((node) => (node.getAttribute('aria-label') || '').includes('Fachada') || (node.currentSrc || node.src || '').includes('portada'))
      if (!origin && (button || cover)) origin = performance.now()
      if (!origin) return
      window.__samples.push({
        t: Math.round(performance.now() - origin),
        shown: Boolean(button && Number(getComputedStyle(button).opacity) > 0.9),
        readyState: cover ? cover.readyState : -1,
        paused: cover ? cover.paused : null,
      })
    }, 100)
  }, Boolean(options.blockPortada))
}

async function dismissCookies(page) {
  const cookies = page.getByRole('button', { name: 'Aceptar cookies' })
  if (await cookies.count()) await cookies.click({ timeout: 3000 }).catch(() => undefined)
}

function firstShown(samples) {
  return samples.find((sample) => sample.shown) || null
}

async function openIphone(browserType, options = {}) {
  const browser = await browserType.launch({
    headless: true,
    ...(browserType.name() === 'chromium' ? { channel: 'chrome' } : {}),
  })
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage()
  await installAutoplayBlock(page, options)
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await dismissCookies(page)
  return { browser, page }
}

async function clickAndPlay(page, label) {
  const enter = page.getByRole('button', { name: 'Ingresar', exact: true })
  await enter.waitFor({ state: 'visible', timeout: 15000 })
  const before = await page.evaluate(() => window.__plays.filter((item) => item.inClick && item.src.includes('ingreso-v2')))
  assert.equal(before.length, 0, `${label}: play() del ingreso ocurrió antes del clic`)
  await enter.click()
  await page.waitForFunction(() => {
    const drone = [...document.querySelectorAll('video')].find((node) => (node.currentSrc || node.src || '').includes('ingreso-v2'))
    return Boolean(drone && !drone.paused && drone.currentTime > 0)
  }, null, { timeout: 15000 })
  const detail = await page.evaluate(() => ({ plays: window.__plays, lastClick: window.__lastClick }))
  const gesture = detail.plays.filter((item) => item.inClick && item.src.includes('ingreso-v2-mobile'))
  assert.ok(gesture.length > 0, `${label}: el clic no llamó play() sobre el ingreso móvil ${JSON.stringify(detail)}`)
}

async function main() {
  const loaded = await openIphone(webkit)
  try {
    await loaded.page.waitForFunction(() => window.__samples.some((sample) => sample.shown && sample.readyState >= 2), null, { timeout: 45000 })
    const samples = await loaded.page.evaluate(() => window.__samples)
    const shown = firstShown(samples)
    const ready = samples.find((sample) => sample.readyState >= 2)
    assert.ok(shown, 'webkit: INGRESAR no apareció')
    assert.ok(ready, 'webkit: la portada no llegó a loadeddata')
    assert.equal(shown.paused, true, 'webkit: la portada se reprodujo con el autoplay bloqueado')
    const followedData = shown.t >= ready.t - 300 && shown.t <= ready.t + 800
    if (followedData) {
      console.log(`PASS iPhone loadeddata en pausa (${ready.t}ms → botón ${shown.t}ms)`)
    } else {
      assert.ok(shown.t >= 2000 && shown.t < 5000 && shown.t + 400 < ready.t, `webkit: el tope de 2,5s no mostró INGRESAR (salió a los ${shown.t}ms, datos a los ${ready.t}ms)`)
      console.log(`PASS iPhone tope mientras la portada cargaba (${shown.t}ms, loadeddata ${ready.t}ms, sigue en pausa)`)
    }
    await clickAndPlay(loaded.page, 'webkit')
    console.log('PASS iPhone: el clic reproduce el dron')
  } finally {
    await loaded.browser.close()
  }

  const fast = await openIphone(chromium)
  try {
    await fast.page.waitForFunction(() => window.__samples.some((sample) => sample.shown), null, { timeout: 20000 })
    const samples = await fast.page.evaluate(() => window.__samples)
    const shown = firstShown(samples)
    const ready = samples.find((sample) => sample.readyState >= 2)
    assert.ok(shown && ready, `chrome: sin botón o sin datos ${JSON.stringify({ shown, ready })}`)
    assert.equal(shown.paused, true, 'chrome: la portada no quedó en pausa')
    assert.ok(shown.t >= ready.t - 300 && shown.t <= ready.t + 800, `chrome: loadeddata (${ready.t}ms) no encendió INGRESAR (salió a los ${shown.t}ms)`)
    assert.ok(shown.t < 2500, `chrome: INGRESAR esperó al tope (${shown.t}ms)`)
    console.log(`PASS loadeddata con autoplay bloqueado (${ready.t}ms → botón ${shown.t}ms)`)
  } finally {
    await fast.browser.close()
  }

  const stalled = await openIphone(webkit, { blockPortada: true })
  try {
    await stalled.page.waitForFunction(() => window.__samples.some((sample) => sample.shown), null, { timeout: 8000 })
    const samples = await stalled.page.evaluate(() => window.__samples)
    const shown = firstShown(samples)
    const ready = samples.find((sample) => sample.readyState >= 2)
    assert.ok(shown, 'sin portada: INGRESAR no apareció')
    assert.equal(ready, undefined, 'sin portada: la portada sí cargó')
    assert.ok(shown.t >= 2000 && shown.t < 5000, `sin portada: INGRESAR salió a los ${shown.t}ms`)
    console.log(`PASS tope de 2,5s sin datos de portada (${shown.t}ms)`)
    await clickAndPlay(stalled.page, 'sin portada')
    console.log('PASS sin portada: el clic reproduce el dron')
  } finally {
    await stalled.browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
