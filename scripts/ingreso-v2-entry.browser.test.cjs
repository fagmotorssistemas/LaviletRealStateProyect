const assert = require('node:assert/strict')
const { chromium, webkit } = require('playwright')

const base = process.env.SHOWROOM_URL || 'http://localhost:3000/tour'

function ingresoUrls(list) {
  return list
    .map((url) => url.split('?')[0])
    .filter((url) => url.includes('/tour/ingreso') || url.includes('/inicio/portada'))
}

async function openTour(browserType, contextOptions, label) {
  const browser = await browserType.launch({
    headless: true,
    ...(browserType.name() === 'chromium' ? { channel: 'chrome' } : {}),
  })
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  const requests = []
  let clicked = false
  page.on('request', (request) => {
    requests.push({ url: request.url(), beforeClick: !clicked })
  })
  await page.addInitScript(() => {
    window.__enterShownEarly = false
    const watch = () => {
      const button = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Ingresar')
      const cover = [...document.querySelectorAll('video')].find((node) => (node.currentSrc || node.src || '').includes('portada'))
      if (!button || getComputedStyle(button).opacity === '0') return
      const painted = Boolean(cover && cover.readyState >= 2 && cover.videoWidth > 0)
      if (!painted) window.__enterShownEarly = true
    }
    const observer = new MutationObserver(watch)
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    setInterval(watch, 100)
  })
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const cookies = page.getByRole('button', { name: 'Aceptar cookies' })
  if (await cookies.count()) await cookies.click().catch(() => undefined)
  const enter = page.getByRole('button', { name: 'Ingresar', exact: true })
  await enter.waitFor({ state: 'visible', timeout: 25000 })
  const early = await page.evaluate(() => window.__enterShownEarly)
  assert.equal(early, false, `${label}: INGRESAR apareció sin el primer cuadro de la portada`)
  let sawIngreso = false
  for (let attempt = 0; attempt < 40 && !sawIngreso; attempt += 1) {
    const loaded = await page.evaluate(() => [
      ...performance.getEntriesByType('resource').map((entry) => entry.name),
      ...[...document.querySelectorAll('video')].map((node) => node.currentSrc || node.src || ''),
    ].join(' '))
    sawIngreso = loaded.includes('ingreso-v2') || requests.some((item) => item.url.includes('ingreso-v2'))
    if (!sawIngreso) await page.waitForTimeout(250)
  }
  assert.equal(sawIngreso, true, `${label}: el ingreso no empezó a descargarse antes de pulsar`)
  const loaded = await page.evaluate(() => [
    ...performance.getEntriesByType('resource').map((entry) => entry.name),
    ...[...document.querySelectorAll('video')].map((node) => node.currentSrc || node.src),
  ])
  const before = ingresoUrls([
    ...requests.filter((item) => item.beforeClick).map((item) => item.url),
    ...loaded,
  ])
  assert.ok(before.some((url) => url.includes('/inicio/portada')), `${label}: la portada no se pidió al montar`)
  assert.ok(before.some((url) => url.includes('/tour/ingreso-v2/')), `${label}: el ingreso no se pidió al montar`)
  assert.equal(before.some((url) => url.endsWith('/tour/ingreso.mp4') || url.includes('/tour/ingreso-hls/') || url.endsWith('/tour/ingreso-mobile.mp4')), false, `${label}: se pidió un video viejo ${JSON.stringify(before)}`)
  clicked = true
  await page.evaluate(() => {
    window.__entry = { withCover: false, black: false, maxOpacity: 0, maxTime: 0 }
    window.__entryTimer = setInterval(() => {
      const videos = [...document.querySelectorAll('video')]
      const cover = videos.find((node) => (node.currentSrc || node.src || '').includes('portada'))
      const drone = videos.find((node) => node !== cover)
      if (!drone) return
      let node = drone.parentElement
      let fade = null
      while (node) {
        const cls = String(node.className || '')
        if (cls.includes('inset-0') && cls.includes('duration-[400ms]')) {
          fade = node
          break
        }
        node = node.parentElement
      }
      const droneOpacity = fade ? Number(getComputedStyle(fade).opacity) : 0
      window.__entry.maxOpacity = Math.max(window.__entry.maxOpacity, droneOpacity)
      window.__entry.maxTime = Math.max(window.__entry.maxTime, drone.currentTime || 0)
      const coverVisible = Boolean(cover && cover.isConnected)
      if (coverVisible && (droneOpacity > 0.05 || drone.currentTime > 0)) window.__entry.withCover = true
      if (!coverVisible && droneOpacity < 0.35 && (drone.currentTime || 0) < 0.05) window.__entry.black = true
    }, 40)
  })
  await enter.click()
  await page.waitForTimeout(4000)
  const gap = await page.evaluate(() => window.__entry)
  assert.equal(gap.withCover, true, `${label}: el dron no apareció encima de la portada (opacidad ${gap.maxOpacity}, t ${gap.maxTime})`)
  assert.equal(gap.black, false, `${label}: hubo un corte negro entre portada e ingreso`)
  const after = await page.evaluate(() => [
    ...performance.getEntriesByType('resource').map((entry) => entry.name),
    ...[...document.querySelectorAll('video')].map((node) => node.currentSrc || node.src),
  ])
  await browser.close()
  return ingresoUrls([...requests.map((item) => item.url), ...after])
}

async function main() {
  const desktop = await openTour(chromium, { viewport: { width: 1366, height: 768 }, hasTouch: false }, 'chrome')
  assert.ok(desktop.some((url) => url.includes('/tour/ingreso-v2/hls/index.m3u8')), `chrome no pidió HLS ${JSON.stringify(desktop)}`)
  assert.equal(desktop.some((url) => url.endsWith('/tour/ingreso-v2/ingreso-v2-mobile.mp4')), false, 'chrome pidió el mp4 de celular')
  console.log('PASS chrome')

  const androidUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  const android = await openTour(
    chromium,
    {
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: androidUa,
    },
    'android',
  )
  assert.ok(android.some((url) => url.endsWith('/tour/ingreso-v2/ingreso-v2-mobile.mp4')), `android no pidió el mp4 móvil ${JSON.stringify(android)}`)
  assert.equal(android.some((url) => url.endsWith('/tour/ingreso-v2/ingreso-v2.mp4') || url.includes('/tour/ingreso-v2/hls/')), false, `android pidió el ingreso de escritorio ${JSON.stringify(android)}`)
  console.log('PASS android')

  const iphone = await openTour(
    webkit,
    { ...require('playwright').devices['iPhone 13'] },
    'iphone',
  )
  assert.ok(iphone.some((url) => url.endsWith('/tour/ingreso-v2/ingreso-v2-mobile.mp4')), `iphone no pidió el mp4 móvil ${JSON.stringify(iphone)}`)
  assert.equal(iphone.some((url) => url.includes('.m3u8') || url.endsWith('/tour/ingreso-v2/ingreso-v2.mp4')), false, `iphone pidió HLS o el mp4 de escritorio ${JSON.stringify(iphone)}`)
  console.log('PASS iphone')

  const safari = await openTour(webkit, { viewport: { width: 1366, height: 768 }, hasTouch: false }, 'safari')
  assert.ok(safari.some((url) => url.endsWith('/tour/ingreso-v2/ingreso-v2.mp4')), `safari no pidió el mp4 ${JSON.stringify(safari)}`)
  assert.equal(safari.some((url) => url.includes('.m3u8')), false, `safari pidió HLS ${JSON.stringify(safari)}`)
  console.log('PASS safari')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
