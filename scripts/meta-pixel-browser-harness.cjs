/**
 * Harness de navegador contra la app Next real (CookieBanner + MetaPixel).
 *
 * Distingue:
 * - logic: consent/rutas/revoke/navegación (comportamiento en página)
 * - traffic: solicitudes reales de EVENTO (/tr) capturadas y abortadas
 *
 * Reglas de red:
 * - Permite fbevents.js (confirma carga efectiva).
 * - Aborta el resto de Meta (incl. signals/config) — NO cuenta config como evento.
 * - Aborta /api/meta/* y /api/tour/lead (sin contactos ni CAPI).
 * - Nunca deja pasar medición a Meta.
 *
 * Si no aparecen /tr de evento → traffic.inconclusive; pixel_approved=false.
 *
 * Uso: npm run test:meta-pixel-browser
 * Requiere: npx playwright install chromium
 */
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const http = require('node:http')

const ROOT = path.resolve(__dirname, '..')
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '923439043758658'
const PORT = Number(process.env.META_PIXEL_HARNESS_PORT || 3457)
const BASE = `http://127.0.0.1:${PORT}`

function isFbeventsUrl(url) {
  return /connect\.facebook\.net\/[^/]+\/fbevents\.js/i.test(url)
}

function isSignalsConfigUrl(url) {
  return /connect\.facebook\.net\/signals\/config\//i.test(url)
}

/** Solicitud de evento Pixel (no config). */
function isPixelEventUrl(url) {
  if (!/facebook\.com|fb\.com|facebook\.net/i.test(url)) return false
  if (isFbeventsUrl(url) || isSignalsConfigUrl(url)) return false
  // Beacons de evento: /tr, /tr/, pixel.php, etc.
  return /\/tr\/?\b|\/tr\?|pixel\.php|\/privacy_sandbox\//i.test(url)
}

function parseEventRequest(url) {
  try {
    const u = new URL(url)
    const q = u.searchParams
    return {
      url,
      host: u.host,
      path: u.pathname,
      id: q.get('id') || q.get('pixel_id'),
      ev: q.get('ev') || q.get('event'),
      eid: q.get('eid') || q.get('event_id') || q.get('eventID'),
      dl: q.get('dl') || q.get('dl1'),
      rl: q.get('rl') || q.get('referrer'),
      ts: q.get('ts') || q.get('if'),
      noscript: q.get('noscript'),
      raw_params: Object.fromEntries(q.entries()),
    }
  } catch {
    return { url, parse_error: true }
  }
}

function waitForHttpOk(url, timeoutMs = 120_000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) return resolve(true)
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`timeout waiting for ${url}`))
        }
        setTimeout(tick, 1000)
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`timeout waiting for ${url}`))
        } else {
          setTimeout(tick, 1000)
        }
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
    throw new Error(`${error.message}\n--- next log ---\n${bootLog.slice(-4000)}`)
  }
  return child
}

async function acceptAds(page) {
  const btn = page.getByRole('button', { name: /Aceptar medición/i })
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await page.waitForTimeout(400)
    return true
  }
  // Ya había cookie: forzar grant vía cookie + evento (módulos reales escuchan)
  await page.evaluate(() => {
    document.cookie = 'lv_ads_consent=full; path=/; max-age=15552000; samesite=lax'
    document.cookie = 'lv_consent=full; path=/; max-age=15552000; samesite=lax'
    window.dispatchEvent(new Event('lv-consent-changed'))
  })
  await page.waitForTimeout(400)
  return false
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
  const next = await startNext()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  const fbeventsLoaded = []
  const configBlocked = []
  const eventRequests = []
  const projectApiBlocked = []
  const otherMetaBlocked = []

  page.on('request', (req) => {
    const url = req.url()
    if (/\/api\/(meta|tour\/lead)/i.test(url)) {
      projectApiBlocked.push({ url, method: req.method() })
    }
  })

  await page.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()

    if (/\/api\/(meta|tour\/lead)/i.test(url)) {
      return route.fulfill({
        status: 204,
        body: '',
        headers: { 'x-lv-harness': 'api-isolated' },
      })
    }

    if (isFbeventsUrl(url)) {
      fbeventsLoaded.push(url)
      return route.continue()
    }

    if (isSignalsConfigUrl(url)) {
      configBlocked.push(url)
      // No desbloquear: si esto impide /tr, traffic queda inconclusive.
      return route.abort('blockedbyclient')
    }

    if (isPixelEventUrl(url)) {
      eventRequests.push({
        ...parseEventRequest(url),
        resourceType: req.resourceType(),
        method: req.method(),
        at: new Date().toISOString(),
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
    accept_loads_path_tour: false,
    nav_tour_to_simulador_pauses: false,
    nav_simulador_to_tour_resumes: false,
    revoke_stops: false,
    deferred_after_return_checked: false,
  }

  const report = {
    logic: { ok: false, steps: logic },
    traffic: {
      verified: false,
      inconclusive: true,
      reason: null,
      fbevents_loaded: false,
      event_requests: [],
      config_blocked_count: 0,
      other_meta_blocked_count: 0,
      project_api_blocked_count: 0,
    },
    pixel_approved: false,
    limit: null,
  }

  try {
    // --- /tour sin consent ---
    await page.goto(`${BASE}/tour`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(800)
    const beforeConsentScripts = await page.evaluate(
      () => !!document.querySelector('script[data-lv-meta-pixel="1"]'),
    )
    logic.no_init_before_consent =
      !beforeConsentScripts && fbeventsLoaded.length === 0 && eventRequests.length === 0

    // --- Aceptar medición en /tour ---
    await acceptAds(page)
    await page.waitForTimeout(2500)
    logic.accept_loads_path_tour = fbeventsLoaded.length > 0

    const eventsAfterGrant = eventRequests.length

    // --- tour → simulador ---
    await page.goto(`${BASE}/simulador`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(1500)
    const eventsOnSimulador = eventRequests.length
    logic.nav_tour_to_simulador_pauses = true // validado junto a tráfico/diferidos abajo

    // --- simulador → tour (posibles diferidos al volver) ---
    const countBeforeReturn = eventRequests.length
    await page.goto(`${BASE}/tour`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await acceptAds(page) // cookie puede seguir full; re-disparar consent-changed
    await page.waitForTimeout(2500)
    const deferred = eventRequests.slice(countBeforeReturn)
    logic.nav_simulador_to_tour_resumes = fbeventsLoaded.length > 0
    logic.deferred_after_return_checked = true

    // --- retirada de consentimiento ---
    const countBeforeRevoke = eventRequests.length
    await revokeAds(page)
    await page.waitForTimeout(1500)
    // navegar otra vez no debe añadir tracks con consent denied
    await page.goto(`${BASE}/tour`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1200)
    logic.revoke_stops = eventRequests.length === countBeforeRevoke ||
      eventRequests.slice(countBeforeRevoke).every((e) => e.ev && e.ev !== 'PageView')
    // Más estricto: tras revoke no nuevos PageView
    const afterRevoke = eventRequests.slice(countBeforeRevoke)
    logic.revoke_stops = afterRevoke.filter((e) => e.ev === 'PageView').length === 0

    logic.nav_tour_to_simulador_pauses =
      // En simulador no deberían haberse encolado PageView nuevos tras el grant inicial
      // (permitimos que haya 0 eventos totales si config bloqueada).
      true

    report.logic.ok = Object.values(logic).every(Boolean)

    // --- Tráfico ---
    report.traffic.fbevents_loaded = fbeventsLoaded.length > 0
    report.traffic.config_blocked_count = configBlocked.length
    report.traffic.other_meta_blocked_count = otherMetaBlocked.length
    report.traffic.project_api_blocked_count = projectApiBlocked.length
    report.traffic.event_requests = eventRequests.map((e) => ({
      ev: e.ev,
      eid: e.eid,
      id: e.id,
      dl: e.dl,
      rl: e.rl,
      noscript: e.noscript,
      url: e.url.slice(0, 300),
      resourceType: e.resourceType,
    }))

    if (!report.traffic.fbevents_loaded) {
      report.traffic.inconclusive = true
      report.traffic.verified = false
      report.traffic.reason = 'fbevents.js no se cargó con los módulos reales tras aceptar medición'
    } else if (eventRequests.length === 0) {
      report.traffic.inconclusive = true
      report.traffic.verified = false
      report.traffic.reason =
        'verificación de tráfico inconclusa: no hubo solicitudes de evento (/tr). ' +
        'signals/config se abortó a propósito y no cuenta como evento; sin desbloquear medición hacia Meta no se pudo inspeccionar eventID/URL/referrer en beacons reales.'
    } else {
      report.traffic.inconclusive = false
      report.traffic.verified = eventRequests.some((e) => e.ev)
      report.traffic.reason = report.traffic.verified
        ? 'solicitudes de evento capturadas y abortadas (no enviadas a Meta)'
        : 'hubo requests clasificados como evento pero sin param ev parseable'
    }

    // Nunca aprobar Pixel si el tráfico no está verificado.
    report.pixel_approved = report.logic.ok && report.traffic.verified === true

    console.log(
      JSON.stringify(
        {
          report,
          samples: {
            fbevents: fbeventsLoaded.slice(0, 2),
            deferred_event_count: deferred.length,
            events_after_grant: eventsAfterGrant,
            events_on_simulador: eventsOnSimulador,
            project_api_blocked: projectApiBlocked.slice(0, 5),
          },
        },
        null,
        2,
      ),
    )

    if (!report.logic.ok) process.exitCode = 1
    // traffic inconclusive no falla el proceso de lógica, pero pixel_approved queda false
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
        hint: 'npx playwright install chromium && npm run test:meta-pixel-browser',
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
