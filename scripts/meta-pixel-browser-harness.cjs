/**
 * Harness Next real: CookieBanner + MetaPixel.
 *
 * Hipótesis a validar:
 * - Abortar signals/config puede impedir que fbevents.js emita /tr.
 * - Servir signals/config en LOCAL (fixture capturado del CDN, no inventado)
 *   permite generar intentos de /tr que aún así se ABORTAN (nunca llegan a Meta).
 *
 * Tráfico:
 * - Permite fbevents.js (CDN Meta, ya usado en lab).
 * - signals/config → fulfill local si hay fixture; si no, abort + inconcluso.
 * - /tr (eventos) → capturar params y abortar.
 * - Resto Meta → abort.
 * - /api/meta/* y /api/tour/lead → 204 (sin contactos/CAPI).
 *
 * Uso:
 *   node scripts/meta-pixel-capture-config.cjs --dry-run   # ver qué se pediría
 *   node scripts/meta-pixel-capture-config.cjs --fetch     # solo si aceptas
 *   npm run test:meta-pixel-browser
 */
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const http = require('node:http')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '923439043758658'
const PORT = Number(process.env.META_PIXEL_HARNESS_PORT || 3457)
const BASE = `http://127.0.0.1:${PORT}`
const CONFIG_FIXTURE = path.join(
  __dirname,
  'fixtures',
  'meta-pixel-config',
  `${PIXEL_ID}.js`,
)
const CONFIG_PROVENANCE = path.join(
  __dirname,
  'fixtures',
  'meta-pixel-config',
  `${PIXEL_ID}.provenance.json`,
)

function isFbeventsUrl(url) {
  return /connect\.facebook\.net\/[^/]+\/fbevents\.js/i.test(url)
}

function isSignalsConfigUrl(url) {
  return /connect\.facebook\.net\/signals\/config\//i.test(url)
}

function isPixelEventUrl(url) {
  if (!/facebook\.com|fb\.com|facebook\.net/i.test(url)) return false
  if (isFbeventsUrl(url) || isSignalsConfigUrl(url)) return false
  return /\/tr\/?\b|\/tr\?|pixel\.php/i.test(url)
}

function parseEventRequest(url) {
  try {
    const u = new URL(url)
    const q = u.searchParams
    return {
      url: url.slice(0, 500),
      host: u.host,
      path: u.pathname,
      id: q.get('id') || q.get('pixel_id'),
      ev: q.get('ev') || q.get('event'),
      eid: q.get('eid') || q.get('event_id') || q.get('eventID'),
      dl: q.get('dl') || q.get('dl1'),
      rl: q.get('rl') || q.get('referrer'),
      noscript: q.get('noscript'),
      raw_params: Object.fromEntries(q.entries()),
    }
  } catch {
    return { url: String(url).slice(0, 500), parse_error: true }
  }
}

function loadLocalConfig() {
  if (!fs.existsSync(CONFIG_FIXTURE)) return null
  const body = fs.readFileSync(CONFIG_FIXTURE, 'utf8')
  let provenance = null
  if (fs.existsSync(CONFIG_PROVENANCE)) {
    try {
      provenance = JSON.parse(fs.readFileSync(CONFIG_PROVENANCE, 'utf8'))
    } catch {
      provenance = { error: 'provenance_unreadable' }
    }
  }
  return { body, provenance, path: CONFIG_FIXTURE }
}

function waitForHttpOk(url, timeoutMs = 120_000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) return resolve(true)
        if (Date.now() - start > timeoutMs) return reject(new Error(`timeout ${url}`))
        setTimeout(tick, 1000)
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`timeout ${url}`))
        else setTimeout(tick, 1000)
      })
    }
    tick()
  })
}

async function startNext() {
  const isWin = process.platform === 'win32'
  const child = spawn(
    isWin ? 'npx.cmd' : 'npx',
    ['next', 'dev', '-p', String(PORT), '-H', '127.0.0.1'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NEXT_PUBLIC_META_PIXEL_SIMULATE: 'false',
        NEXT_PUBLIC_META_PIXEL_ID: PIXEL_ID,
        NEXT_PUBLIC_COOKIE_BANNER_ENABLED: 'true',
        NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE: 'true',
        META_CAPI_DELIVERY_LANE: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
    },
  )
  let bootLog = ''
  child.stdout.on('data', (d) => {
    bootLog += d.toString()
  })
  child.stderr.on('data', (d) => {
    bootLog += d.toString()
  })
  try {
    await waitForHttpOk(`${BASE}/tour`)
  } catch (error) {
    child.kill('SIGTERM')
    throw new Error(`${error.message}\n--- next ---\n${bootLog.slice(-4000)}`)
  }
  return child
}

async function acceptAds(page) {
  const btn = page.getByRole('button', { name: /Aceptar medición/i })
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await page.waitForTimeout(400)
    return 'banner'
  }
  await page.evaluate(() => {
    document.cookie = 'lv_ads_consent=full; path=/; max-age=15552000; samesite=lax'
    document.cookie = 'lv_consent=full; path=/; max-age=15552000; samesite=lax'
    window.dispatchEvent(new Event('lv-consent-changed'))
  })
  await page.waitForTimeout(400)
  return 'cookie'
}

async function revokeAds(page) {
  await page.evaluate(() => {
    document.cookie = 'lv_ads_consent=denied; path=/; max-age=15552000; samesite=lax'
    document.cookie = 'lv_consent=denied; path=/; max-age=15552000; samesite=lax'
    window.dispatchEvent(new Event('lv-consent-changed'))
  })
  await page.waitForTimeout(500)
}

async function main() {
  const localConfig = loadLocalConfig()
  const next = await startNext()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  const fbeventsLoaded = []
  const configServedLocal = []
  const configAbortedNoFixture = []
  const eventRequests = []
  const projectApiBlocked = []
  const otherMetaBlocked = []

  await page.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()

    if (/\/api\/(meta|tour\/lead)/i.test(url)) {
      projectApiBlocked.push({ url, method: req.method() })
      return route.fulfill({ status: 204, body: '', headers: { 'x-lv-harness': 'api-isolated' } })
    }

    if (isFbeventsUrl(url)) {
      fbeventsLoaded.push(url)
      return route.continue()
    }

    if (isSignalsConfigUrl(url)) {
      if (localConfig) {
        configServedLocal.push(url)
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript; charset=utf-8',
          body: localConfig.body,
          headers: { 'x-lv-harness': 'signals-config-local-fixture' },
        })
      }
      configAbortedNoFixture.push(url)
      return route.abort('blockedbyclient')
    }

    if (isPixelEventUrl(url)) {
      eventRequests.push({
        ...parseEventRequest(url),
        resourceType: req.resourceType(),
        method: req.method(),
        at: new Date().toISOString(),
        page_url: page.url(),
      })
      return route.abort('blockedbyclient')
    }

    if (/facebook\.com|facebook\.net|fbcdn\.net|fb\.com/i.test(url)) {
      otherMetaBlocked.push(url)
      return route.abort('blockedbyclient')
    }

    return route.continue()
  })

  const logic = {
    no_init_before_consent: false,
    accept_loads_fbevents: false,
    nav_tour_to_simulador: false,
    nav_simulador_to_tour: false,
    revoke_stops_new_pageview: false,
  }

  const report = {
    hypothesis: {
      text: 'Abortar signals/config puede impedir que el SDK emita /tr; servir config local (capturada) permite observar intentos /tr sin enviarlos a Meta.',
      local_config_present: Boolean(localConfig),
      local_config_provenance: localConfig?.provenance || null,
      capture_hint:
        'Sin fixture: node scripts/meta-pixel-capture-config.cjs --dry-run  (luego --fetch solo si aceptas la transmisión)',
    },
    logic: { ok: false, steps: logic },
    traffic: {
      verified: false,
      inconclusive: true,
      reason: null,
      fbevents_loaded: false,
      config_mode: localConfig ? 'local_fixture' : 'aborted_no_fixture',
      config_served_local_count: 0,
      config_aborted_count: 0,
      event_requests: [],
      deferred_after_return: [],
      project_api_blocked_count: 0,
    },
    pixel_approved: false,
    limit: null,
  }

  try {
    await page.goto(`${BASE}/tour`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(600)
    logic.no_init_before_consent = fbeventsLoaded.length === 0 && eventRequests.length === 0

    await acceptAds(page)
    await page.waitForTimeout(2800)
    logic.accept_loads_fbevents = fbeventsLoaded.length > 0
    const eventsAfterGrant = eventRequests.slice()

    await page.goto(`${BASE}/simulador`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(1200)
    logic.nav_tour_to_simulador = true
    const countAtSimulador = eventRequests.length

    const beforeReturn = eventRequests.length
    await page.goto(`${BASE}/tour`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await acceptAds(page)
    await page.waitForTimeout(2800)
    logic.nav_simulador_to_tour = fbeventsLoaded.length > 0
    const deferred = eventRequests.slice(beforeReturn)

    const beforeRevoke = eventRequests.length
    await revokeAds(page)
    await page.goto(`${BASE}/tour`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1200)
    const afterRevoke = eventRequests.slice(beforeRevoke)
    logic.revoke_stops_new_pageview = afterRevoke.filter((e) => e.ev === 'PageView').length === 0

    report.logic.ok = Object.values(logic).every(Boolean)

    report.traffic.fbevents_loaded = fbeventsLoaded.length > 0
    report.traffic.config_served_local_count = configServedLocal.length
    report.traffic.config_aborted_count = configAbortedNoFixture.length
    report.traffic.project_api_blocked_count = projectApiBlocked.length
    report.traffic.event_requests = eventRequests.map((e) => ({
      ev: e.ev,
      eid: e.eid,
      id: e.id,
      dl: e.dl,
      rl: e.rl,
      noscript: e.noscript,
      page_url: e.page_url,
      url: e.url,
      at: e.at,
    }))
    report.traffic.deferred_after_return = deferred.map((e) => ({
      ev: e.ev,
      eid: e.eid,
      dl: e.dl,
      rl: e.rl,
      page_url: e.page_url,
    }))

    if (!localConfig) {
      report.traffic.inconclusive = true
      report.traffic.verified = false
      report.traffic.reason =
        'verificación de tráfico inconclusa: no hay fixture local de signals/config. ' +
        'Abortar config (como en corridas previas) dejó 0 /tr. No se inventó el cuerpo; falta captura documentada.'
      report.limit =
        'Para continuar hace falta GET a connect.facebook.net/signals/config/{PIXEL_ID} ' +
        '(ver node scripts/meta-pixel-capture-config.cjs --dry-run). No ejecutado en esta corrida.'
    } else if (!report.traffic.fbevents_loaded) {
      report.traffic.inconclusive = true
      report.traffic.verified = false
      report.traffic.reason = 'fbevents.js no cargó'
    } else if (eventRequests.length === 0) {
      report.traffic.inconclusive = true
      report.traffic.verified = false
      report.traffic.reason =
        'config local servida pero aún no hubo /tr abortados; no se aprueba Pixel'
    } else {
      report.traffic.inconclusive = false
      report.traffic.verified = true
      report.traffic.reason =
        'intentos /tr capturados e inspeccionados; abortados (no enviados a Meta). signals/config no cuenta como evento.'
    }

    report.pixel_approved = report.logic.ok && report.traffic.verified === true

    console.log(
      JSON.stringify(
        {
          report,
          samples: {
            fbevents: fbeventsLoaded.slice(0, 2),
            config_local: configServedLocal.slice(0, 2),
            config_aborted: configAbortedNoFixture.slice(0, 2),
            events_after_grant: eventsAfterGrant.length,
            events_while_simulador_marker: countAtSimulador,
            project_api: projectApiBlocked.slice(0, 5),
            other_meta_blocked: otherMetaBlocked.slice(0, 5),
          },
        },
        null,
        2,
      ),
    )

    if (!report.logic.ok) process.exitCode = 1
  } catch (error) {
    report.limit = error instanceof Error ? error.message : String(error)
    report.pixel_approved = false
    console.error(JSON.stringify({ report }, null, 2))
    process.exitCode = 1
  } finally {
    await browser.close().catch(() => {})
    next.kill('SIGTERM')
    setTimeout(() => {
      try {
        next.kill('SIGKILL')
      } catch {
        // ignore
      }
    }, 3000).unref?.()
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        pixel_approved: false,
        limit: String(error?.message || error),
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
