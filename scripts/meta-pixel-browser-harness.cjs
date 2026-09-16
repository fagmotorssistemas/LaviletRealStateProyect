/**
 * Harness de navegador: carga fbevents.js real pero BLOQUEA salidas de medición
 * (facebook.com/tr, graph, etc.) y APIs del proyecto (lead/meta) para no crear
 * contactos ni eventos CAPI.
 *
 * Uso:
 *   npx --yes playwright install chromium
 *   node scripts/meta-pixel-browser-harness.mjs
 *
 * No publica ni activa Pixel en Production. Solo fixture local.
 */
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '923439043758658'
const FIXTURE = path.join(__dirname, 'fixtures', 'meta-pixel-browser.html')

const BLOCK_HOST_RE =
  /(facebook\.com|fbcdn\.net|facebook\.net).*\/(tr|tr\/|privacy_sandbox|offline_event)/i
const BLOCK_API_RE = /\/api\/(meta|tour\/lead)/i

function startFixtureServer() {
  const html = fs
    .readFileSync(FIXTURE, 'utf8')
    .replaceAll('__PIXEL_ID__', PIXEL_ID)
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/index')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    if (req.url === '/tour') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html.replace('data-path="/"', 'data-path="/tour"'))
      return
    }
    if (req.url?.startsWith('/simulador')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html.replace('data-path="/"', 'data-path="/simulador"'))
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, base: `http://127.0.0.1:${port}` })
    })
  })
}

async function main() {
  const { server, base } = await startFixtureServer()
  const blocked = []
  const allowedMetaScript = []

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  page.on('request', (req) => {
    const url = req.url()
    if (/\/api\/(meta|tour\/lead)/i.test(url)) {
      blocked.push({ url, reason: 'project_api', phase: 'request' })
    } else if (/facebook\.com|facebook\.net|fbcdn\.net|fb\.com/i.test(url)) {
      if (/fbevents\.js/.test(url)) allowedMetaScript.push(url)
      else blocked.push({ url, reason: 'measurement_seen', phase: 'request' })
    }
  })

  await page.route('**/*', async (route) => {
    const url = route.request().url()
    const type = route.request().resourceType()

    if (BLOCK_API_RE.test(url)) {
      return route.fulfill({ status: 204, body: '' })
    }
    if (/connect\.facebook\.net\/.*\/fbevents\.js/.test(url)) {
      return route.continue()
    }
    if (/facebook\.com|facebook\.net|fbcdn\.net|fb\.com/i.test(url)) {
      // Bloquear toda medición saliente (tr, pixel, xhr, beacon).
      return route.abort('blockedbyclient')
    }
    void type
    return route.continue()
  })

  const report = {
    ok: false,
    steps: {},
    blocked_measurement: 0,
    blocked_project_api: 0,
    fbevents_loaded: false,
    limit: null,
  }

  try {
    // 1) /tour sin consent → no init
    await page.goto(`${base}/tour`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => window.__lvHarness.setPath('/tour'))
    let state = await page.evaluate(() => window.__lvHarness.snapshot())
    report.steps.no_consent_no_init = state.log.every((e) => e.args[0] !== 'init')

    // 2) grant en /tour → autoConfig false + init + PageView eventID
    const pageViewId = await page.evaluate(() => {
      window.__lvHarness.setConsent(true)
      window.__lvHarness.applyConsent(true)
      return window.__lvHarness.track('PageView')
    })
    await page.waitForTimeout(1500)
    state = await page.evaluate(() => window.__lvHarness.snapshot())
    report.steps.grant_autoconfig =
      state.log.some((e) => e.args[0] === 'set' && e.args[1] === 'autoConfig' && e.args[2] === false) &&
      state.log.some((e) => e.args[0] === 'init') &&
      state.log.some((e) => e.args[0] === 'track' && e.args[1] === 'PageView')
    report.steps.pageview_event_id = Boolean(pageViewId)
    report.steps.pageview_dl = state.lastTrackOptions?.eventID === pageViewId
    report.fbevents_loaded = allowedMetaScript.length > 0

    // Esperar a que fbevents procese la cola y dispare /tr (abortado).
    await page.waitForTimeout(2000)

    // 3) ViewContent con eventID compartido
    const vcId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await page.evaluate((id) => window.__lvHarness.track('ViewContent', id), vcId)
    state = await page.evaluate(() => window.__lvHarness.snapshot())
    const vc = state.log.find((e) => e.args[0] === 'track' && e.args[1] === 'ViewContent')
    report.steps.viewcontent_event_id = vc && vc.args[3]?.eventID === vcId

    // 4) navegar a /simulador con script previo → revoke / sin tracks
    await page.evaluate(() => {
      window.__lvHarness.setPath('/simulador')
      window.__lvHarness.syncRoute('/simulador')
    })
    state = await page.evaluate(() => window.__lvHarness.snapshot())
    report.steps.nav_simulador_revoke = state.log.some(
      (e) => e.args[0] === 'consent' && e.args[1] === 'revoke',
    )
    const before = state.log.length
    await page.evaluate(() => window.__lvHarness.track('PageView'))
    state = await page.evaluate(() => window.__lvHarness.snapshot())
    report.steps.nav_simulador_no_track = state.log.length === before

    // 5) aceptar en /simulador → no init nuevo (ruta excluida)
    await page.evaluate(() => {
      window.__lvHarness.clearLog()
      window.__lvHarness.setConsent(true)
      window.__lvHarness.applyConsent(true)
      window.__lvHarness.track('PageView')
    })
    state = await page.evaluate(() => window.__lvHarness.snapshot())
    report.steps.accept_on_simulador_no_init = !state.log.some((e) => e.args[0] === 'init')

    // 6) revoke total
    await page.evaluate(() => {
      window.__lvHarness.setPath('/tour')
      window.__lvHarness.setConsent(false)
      window.__lvHarness.applyConsent(false)
    })
    state = await page.evaluate(() => window.__lvHarness.snapshot())
    report.steps.full_revoke = state.consentFlag === 'revoke'

    // URL/referrer observados en la página (no tráfico saliente)
    report.steps.location = await page.evaluate(() => ({
      href: location.href,
      pathname: location.pathname,
      referrer: document.referrer,
    }))

    report.blocked_measurement = blocked.filter((b) =>
      String(b.reason).startsWith('measurement'),
    ).length
    report.blocked_project_api = blocked.filter((b) => b.reason === 'project_api').length
    report.ok = Object.entries(report.steps)
      .filter(([k]) => k !== 'location')
      .every(([, v]) => v === true)
    // /tr puede no dispararse si fbevents no hidrata a tiempo; no falla el harness de lógica.
    if (report.fbevents_loaded && report.blocked_measurement === 0) {
      report.limit =
        'fbevents.js cargó pero no se observó /tr abortado en la ventana de espera (cola o timing). La lógica de consent/ruta/eventID sí pasó; medición saliente no verificada por red.'
    }

    console.log(JSON.stringify({ report, blocked_sample: blocked.slice(0, 8) }, null, 2))
    if (!report.ok) process.exitCode = 1
  } catch (error) {
    report.limit = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ report, error: report.limit }, null, 2))
    process.exitCode = 1
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      limit:
        'No se pudo ejecutar el harness de navegador (¿playwright/chromium instalado?). ' +
        String(error?.message || error),
      hint: 'npx playwright install chromium && node scripts/meta-pixel-browser-harness.cjs',
    }, null, 2),
  )
  process.exitCode = 1
})
