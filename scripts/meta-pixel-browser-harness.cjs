/**
 * Harness Pixel — HTTPS www.lavilett.com (lab).
 *
 * Limitaciones corregidas:
 * 1) tour → simulador → tour vía navegación cliente (Link), sin recargar documento.
 * 2) ViewContent = ficha real; Lead = formulario real. Sin fbq manual.
 *
 * Medición Meta abortada. /api/meta/* y /api/tour/lead simuladas (sin contactos).
 * Resto /api/tour/* y financing continúan (catálogo real).
 */
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '923439043758658'
const PORT = Number(process.env.META_PIXEL_HARNESS_PORT || 3443)
const HARNESS_DOMAIN = process.env.META_PIXEL_HARNESS_DOMAIN || 'www.lavilett.com'
const USE_HTTPS = process.env.META_PIXEL_HARNESS_HTTPS !== 'false'
const PROTOCOL = USE_HTTPS ? 'https' : 'http'
const BASE = `${PROTOCOL}://${HARNESS_DOMAIN}:${PORT}`

const FIXTURE_STEM =
  HARNESS_DOMAIN === '127.0.0.1' ? PIXEL_ID : `${PIXEL_ID}.${HARNESS_DOMAIN}`
const CONFIG_FIXTURE = path.join(__dirname, 'fixtures', 'meta-pixel-config', `${FIXTURE_STEM}.js`)
const CONFIG_PROVENANCE = path.join(
  __dirname,
  'fixtures',
  'meta-pixel-config',
  `${FIXTURE_STEM}.provenance.json`,
)

const LAB_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const LAB_VISITOR = 'lab-visitor-meta-harness'
const LAB_LEAD_META_EVENT_ID = crypto.randomUUID()

const RESTRICTED_RE =
  /(?:password|secret|authorization|bearer|access_token|[\w.+-]+@[\w.-]+\.\w{2,}|(?:^|[?&#/])(?:phone|tel|email|correo)=)/i

function isFbeventsUrl(url) {
  return /connect\.facebook\.net\/[^/]+\/fbevents\.js/i.test(url)
}
function isSignalsConfigUrl(url) {
  return /connect\.facebook\.net\/signals\/config\//i.test(url)
}
function isPixelEventUrl(url) {
  if (!/facebook\.com|fb\.com|facebook\.net/i.test(url)) return false
  if (isFbeventsUrl(url) || isSignalsConfigUrl(url)) return false
  return /\/tr\/?\?/i.test(url) || /\/tr\/?$/i.test(url.split('#')[0]) || /pixel\.php/i.test(url)
}
function isOpenBridgeUrl(url) {
  return /\.on\.aws\b|\.run\.app\b|cloudbridge/i.test(url)
}

function parseEventRequest(url, post) {
  try {
    const u = new URL(url)
    const q = new URLSearchParams(u.search)
    if (post && typeof post === 'string') {
      try {
        const sp = new URLSearchParams(post)
        for (const [k, v] of sp.entries()) if (!q.has(k)) q.set(k, v)
      } catch {
        /* ignore */
      }
    }
    const raw = Object.fromEntries(q.entries())
    return {
      url: url.slice(0, 700),
      ev: q.get('ev') || q.get('event'),
      eid: q.get('eid') || q.get('event_id') || q.get('eventID'),
      dl: q.get('dl') || q.get('dl1'),
      rl: q.get('rl') || q.get('referrer'),
      id: q.get('id'),
      raw_params_keys: Object.keys(raw),
    }
  } catch {
    return { url: String(url).slice(0, 500), parse_error: true }
  }
}

function assertNoRestricted(label, value) {
  if (value == null || value === '') return { ok: true, label, value: value ?? null }
  const s = String(value)
  if (RESTRICTED_RE.test(s)) {
    return { ok: false, label, value: s.slice(0, 200), reason: 'possible_restricted_pattern' }
  }
  // page_url del harness es location.href al interceptar /tr (puede adelantarse en SPA).
  // La exclusión de financiamiento se valida con dl/rl/event_source_url (payload Meta) y tr_on_simulador.
  if (/page_url$/i.test(label)) {
    return { ok: true, label, value: s.slice(0, 200), note: 'diagnostic_browser_location' }
  }
  if (/\/simulador(?:\/|$|\?)/i.test(s)) {
    return { ok: false, label, value: s.slice(0, 200), reason: 'financing_path_in_measurement' }
  }
  return { ok: true, label, value: s.slice(0, 200) }
}

function loadLocalConfig() {
  if (!fs.existsSync(CONFIG_FIXTURE)) return null
  const body = fs.readFileSync(CONFIG_FIXTURE, 'utf8')
  let provenance = null
  if (fs.existsSync(CONFIG_PROVENANCE)) {
    try {
      provenance = JSON.parse(fs.readFileSync(CONFIG_PROVENANCE, 'utf8'))
    } catch {
      provenance = { error: 'unreadable' }
    }
  }
  return { body, provenance }
}

function waitForHttpOk(url, timeoutMs = 180_000) {
  const start = Date.now()
  const lib = url.startsWith('https') ? https : http
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = lib.get(url, { rejectUnauthorized: false }, (res) => {
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
  const args = ['next', 'dev', '-p', String(PORT), '-H', '127.0.0.1']
  if (USE_HTTPS) args.push('--experimental-https')
  const child = spawn(isWin ? 'npx.cmd' : 'npx', args, {
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
  })
  let bootLog = ''
  child.stdout.on('data', (d) => {
    bootLog += d.toString()
  })
  child.stderr.on('data', (d) => {
    bootLog += d.toString()
  })
  try {
    await waitForHttpOk(`${PROTOCOL}://127.0.0.1:${PORT}/inicio`)
  } catch (error) {
    child.kill('SIGTERM')
    throw new Error(`${error.message}\n--- next ---\n${bootLog.slice(-5000)}`)
  }
  return child
}

async function acceptAds(page) {
  const btn = page.getByRole('button', { name: /Aceptar medición/i })
  await page.waitForTimeout(600)
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await page.waitForTimeout(500)
    return 'banner'
  }
  await page.evaluate(() => {
    document.cookie = 'lv_ads_consent=full; path=/; max-age=15552000; samesite=lax'
    document.cookie = 'lv_consent=full; path=/; max-age=15552000; samesite=lax'
    window.dispatchEvent(new Event('lv-consent-changed'))
  })
  await page.waitForTimeout(500)
  return 'cookie'
}

async function waitPath(page, re, timeout = 60000) {
  try {
    await page.waitForFunction(
      (pattern) => new RegExp(pattern).test(location.pathname),
      re.source,
      { timeout },
    )
  } catch (error) {
    const actual = await page.evaluate(() => location.pathname + location.search).catch(() => '?')
    throw new Error(
      `waitPath ${re}: timeout; pathname actual=${actual}; ${error instanceof Error ? error.message : error}`,
    )
  }
}

/**
 * Navegación cliente vía <Link>. En /inicio|/nosotros el SiteHeader arranca inert
 * hasta lavilet-hero-locked; al cambiar pathname el módulo heroLock puede resetear
 * y volver a poner inert — hay que re-desbloquear antes del click real (sin force).
 */
async function ensureMarketingHeaderInteractive(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('lavilet-hero-locked'))
  })
  try {
    await page.waitForFunction(() => {
      const h = document.querySelector('[data-site-header]')
      return Boolean(h && !h.hasAttribute('inert'))
    }, { timeout: 4000 })
  } catch {
    await page.evaluate(() => {
      const h = document.querySelector('[data-site-header]')
      if (!h) return
      h.removeAttribute('inert')
      h.setAttribute('aria-hidden', 'false')
      h.classList.remove('pointer-events-none')
      h.style.setProperty('transform', 'none', 'important')
      h.style.setProperty('opacity', '1', 'important')
      h.style.setProperty('pointer-events', 'auto', 'important')
      h.style.setProperty('visibility', 'visible', 'important')
    })
  }
  await page.waitForTimeout(200)
}

async function softClickHref(page, href, labelForError) {
  await ensureMarketingHeaderInteractive(page)

  const inHeader = page.locator(`[data-site-header] a[href="${href}"]`)
  if (await inHeader.count()) {
    // Click DOM del Link de Next (no location.assign): SPA sin reload de documento.
    const ok = await page.evaluate((target) => {
      const header = document.querySelector('[data-site-header]')
      if (header?.hasAttribute('inert')) {
        header.removeAttribute('inert')
        header.setAttribute('aria-hidden', 'false')
        header.classList.remove('pointer-events-none')
        header.style.setProperty('transform', 'none', 'important')
        header.style.setProperty('opacity', '1', 'important')
        header.style.setProperty('pointer-events', 'auto', 'important')
      }
      const link = header?.querySelector(`a[href="${target}"]`)
      if (!link) return false
      link.click()
      return true
    }, href)
    if (ok) return
  }

  const openMenu = page.getByRole('button', { name: /Abrir menú/i })
  if (await openMenu.isVisible().catch(() => false)) {
    await openMenu.click()
    await page.waitForTimeout(300)
    const inDrawer = page.locator(`[data-site-header] a[href="${href}"]`)
    if (await inDrawer.count()) {
      await inDrawer.first().click({ timeout: 15000 })
      return
    }
  }

  const clicked = await page.evaluate((target) => {
    const existing = document.querySelector(`a[href="${target}"]`)
    if (existing) {
      existing.click()
      return true
    }
    return false
  }, href)
  if (clicked) return

  throw new Error(`No se encontró link SPA ${labelForError} (href=${href})`)
}

async function main() {
  const localConfig = loadLocalConfig()
  if (!localConfig) {
    console.error(
      JSON.stringify({
        verdict: 'bloqueo',
        limit: `Falta fixture ${CONFIG_FIXTURE}`,
      }),
    )
    process.exitCode = 1
    return
  }

  const next = await startNext()
  const browser = await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=MAP ${HARNESS_DOMAIN} 127.0.0.1`],
  })
  const context = await browser.newContext({
    userAgent: LAB_CHROME_UA,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    baseURL: BASE,
  })
  const page = await context.newPage()

  let documentLoads = 0
  page.on('load', () => {
    documentLoads += 1
  })

  const fbeventsLoaded = []
  const configServedLocal = []
  const eventRequests = []
  const apiSimulated = []
  const enqueueBodies = []
  const leadBodies = []

  await page.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()

    if (/\/api\/meta\/consent/i.test(url)) {
      apiSimulated.push({ path: '/api/meta/consent', method, status: 204 })
      return route.fulfill({ status: 204, body: '' })
    }

    if (/\/api\/meta\/enqueue/i.test(url) && method === 'POST') {
      let body = {}
      try {
        body = req.postDataJSON() || {}
      } catch {
        body = {}
      }
      enqueueBodies.push(body)
      const eventId =
        typeof body.event_id === 'string' && body.event_id ? body.event_id : crypto.randomUUID()
      const payload = { ok: true, event_id: eventId, simulated: true }
      apiSimulated.push({
        path: '/api/meta/enqueue',
        method,
        status: 200,
        request: {
          event_name: body.event_name,
          event_id: body.event_id,
          unit_id: body.unit_id,
          event_source_url: body.event_source_url,
        },
        response: payload,
      })
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      })
    }

    if (/\/api\/tour\/lead/i.test(url) && method === 'POST') {
      let body = {}
      try {
        body = req.postDataJSON() || {}
      } catch {
        body = {}
      }
      leadBodies.push(body)
      const payload = {
        lead_id: '00000000-0000-4000-8000-000000000099',
        emit_meta_lead: true,
        meta_event_id: LAB_LEAD_META_EVENT_ID,
        simulated: true,
        note: 'harness — no contacto real',
      }
      apiSimulated.push({ path: '/api/tour/lead', method, status: 200, response: payload })
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      })
    }

    if (/\/api\/meta\//i.test(url)) {
      return route.fulfill({ status: 204, body: '' })
    }

    // Catálogo / session / events / financing: continuar (ficha real).
    if (/\/api\/(tour|financing)\//i.test(url) && !/\/api\/tour\/lead/i.test(url)) {
      return route.continue()
    }

    if (isFbeventsUrl(url)) {
      fbeventsLoaded.push(url)
      return route.continue()
    }

    if (isSignalsConfigUrl(url)) {
      configServedLocal.push(url.slice(0, 200))
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: localConfig.body,
      })
    }

    if (isPixelEventUrl(url) || (/facebook\.com\/tr/i.test(url) && !isFbeventsUrl(url))) {
      let post = null
      try {
        post = req.postData()
      } catch {
        post = null
      }
      eventRequests.push({
        channel: 'tr',
        ...parseEventRequest(url, post),
        at: new Date().toISOString(),
        page_url: page.url(),
        pathname: (() => {
          try {
            return new URL(page.url()).pathname
          } catch {
            return null
          }
        })(),
      })
      return route.abort('blockedbyclient')
    }

    if (isOpenBridgeUrl(url) || /facebook\.com|facebook\.net|fbcdn\.net|fb\.com/i.test(url)) {
      return route.abort('blockedbyclient')
    }

    return route.continue()
  })

  const report = {
    verdict: 'bloqueo',
    origin: BASE,
    config_provenance: localConfig.provenance,
    spa_nav: null,
    viewcontent: null,
    lead: null,
    restricted_checks: [],
    pixel_compatible: false,
    pixel_approved: false,
    limit: null,
    activation_plan: null,
  }

  try {
    // ——— 1) Carga inicial + consentimiento ———
    await page.goto(`${BASE}/inicio`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
    await page.evaluate((vid) => {
      document.cookie = `lv_vid=${vid}; path=/; max-age=15552000; samesite=lax`
    }, LAB_VISITOR)
    const loadsAfterFirst = documentLoads
    await acceptAds(page)
    await page.waitForTimeout(3500)

    // Identidad showroom para ver “Calcular cuota” en el nav.
    await page.evaluate(() => {
      localStorage.setItem('lv_showroom_phone', '0999999999')
      window.dispatchEvent(new Event('lv:showroom-identity'))
    })
    await page.waitForTimeout(400)

    // ——— 2) SPA: tour → simulador → tour (Links; sin reload de documento) ———
    // Entrada a tour desde inicio (también cliente); el segmento medido empieza en /tour.
    await softClickHref(page, '/tour', 'Showroom 360')
    await waitPath(page, /^\/tour$/)
    await page.waitForTimeout(3500)
    const trAfterTour = eventRequests.filter((e) => e.channel === 'tr').length
    const loadsAtTour = documentLoads

    // Tour no monta SiteHeader: salir a /inicio por Link del viewer, luego a /simulador.
    await page.getByRole('link', { name: /Volver a la (página )?web/i }).first().click()
    await waitPath(page, /^\/inicio$/)
    await page.waitForTimeout(600)

    await page.evaluate(() => {
      localStorage.setItem('lv_showroom_phone', '0999999999')
      window.dispatchEvent(new Event('lv:showroom-identity'))
    })
    await ensureMarketingHeaderInteractive(page)
    await page.locator('[data-site-header] a[href="/simulador"]').waitFor({
      state: 'attached',
      timeout: 20000,
    })

    await softClickHref(page, '/simulador', 'Calcular cuota')
    await waitPath(page, /^\/simulador$/)
    const enteredSimAt = new Date().toISOString()
    const eidsBeforeSim = new Set(
      eventRequests.filter((e) => e.channel === 'tr' && e.ev === 'PageView' && e.eid).map((e) => e.eid),
    )
    await page.waitForTimeout(2000)

    // /simulador: header siempre ready; Link “Showroom 360” → /tour.
    await softClickHref(page, '/tour', 'Showroom 360')
    await waitPath(page, /^\/tour$/)
    const returnedTourAt = new Date().toISOString()

    // PageView de retorno puede llegar justo al cambiar pathname (antes de un slice por índice).
    let returnPageView = null
    for (let i = 0; i < 40; i++) {
      returnPageView =
        eventRequests.find(
          (e) =>
            e.channel === 'tr' &&
            e.ev === 'PageView' &&
            e.eid &&
            !eidsBeforeSim.has(e.eid) &&
            typeof e.pathname === 'string' &&
            e.pathname.startsWith('/tour'),
        ) || null
      if (returnPageView) break
      await page.waitForTimeout(200)
    }

    const trOnSimulador = eventRequests.filter((e) => {
      if (e.channel !== 'tr') return false
      if (!e.at || e.at < enteredSimAt || e.at >= returnedTourAt) return false
      const path = e.pathname || ''
      return path === '/simulador' || path.startsWith('/simulador/')
    })
    // Loads desde el primer /tour del tramo pedido (tour→sim→tour).
    const spaLoads = documentLoads - loadsAtTour
    const noEventsOnExcluded = trOnSimulador.length === 0
    const notRetained =
      noEventsOnExcluded && Boolean(returnPageView?.eid) && !eidsBeforeSim.has(returnPageView.eid)

    report.spa_nav = {
      document_loads_during_spa_segment: spaLoads,
      client_nav_ok: spaLoads === 0,
      path_sequence_ok: true,
      tr_on_simulador: trOnSimulador.map((e) => ({
        ev: e.ev,
        eid: e.eid,
        page_url: e.page_url,
        pathname: e.pathname,
      })),
      no_events_on_excluded_route: noEventsOnExcluded,
      return_pageview: returnPageView
        ? {
            eid: returnPageView.eid,
            dl: returnPageView.dl,
            page_url: returnPageView.page_url,
            pathname: returnPageView.pathname,
          }
        : null,
      not_retained_on_return: notRetained,
      phase: { enteredSimAt, returnedTourAt, trAfterTour },
      initial_document_loads: loadsAfterFirst,
    }

    // ——— 3) ViewContent vía ficha real (?unidad=) ———
    const unit = await page.evaluate(async () => {
      const res = await fetch('/api/tour/catalog')
      if (!res.ok) return { error: `catalog ${res.status}` }
      const json = await res.json()
      const units = Array.isArray(json.units) ? json.units : []
      const u = units.find((x) => x.unit_number) || units[0]
      if (!u) return { error: 'no_units' }
      return {
        id: u.id,
        unit_number: u.unit_number,
        category: u.category || null,
      }
    })
    if (unit.error) throw new Error(`catalog: ${unit.error}`)

    const enqueueBefore = enqueueBodies.length
    const trBeforeVc = eventRequests.length
    await page.goto(`${BASE}/tour?unidad=${encodeURIComponent(unit.unit_number)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await acceptAds(page)
    // Ficha / MetaViewContentUnit
    await page.getByRole('dialog', { name: /Ficha técnica/i }).waitFor({ timeout: 90000 }).catch(() => {})
    await page.waitForTimeout(4500)

    const enqueueVc = enqueueBodies
      .slice(enqueueBefore)
      .filter((b) => b.event_name === 'ViewContent')
      .at(-1)
    const trVc = eventRequests
      .slice(trBeforeVc)
      .filter((e) => e.channel === 'tr' && e.ev === 'ViewContent')
      .at(-1)

    report.viewcontent = {
      unit,
      enqueue_event_id: enqueueVc?.event_id || null,
      enqueue_unit_id: enqueueVc?.unit_id || null,
      enqueue_event_source_url: enqueueVc?.event_source_url || null,
      tr_eid: trVc?.eid || null,
      tr_dl: trVc?.dl || null,
      tr_rl: trVc?.rl || null,
      shared_event_id: Boolean(
        enqueueVc?.event_id && trVc?.eid && enqueueVc.event_id === trVc.eid,
      ),
      unit_id_matches: Boolean(enqueueVc?.unit_id && enqueueVc.unit_id === unit.id),
      no_manual_fbq: true,
    }

    // ——— 4) Lead vía formulario real ———
    const trBeforeLead = eventRequests.length
    const leadApiBefore = leadBodies.length
    const solicitar = page.getByRole('button', { name: /Solicitar información/i })
    await solicitar.waitFor({ timeout: 30000 })
    await solicitar.click()
    await page.getByRole('heading', { name: /Solicitar información/i }).waitFor({ timeout: 15000 })

    await page.locator('input[name="name"]').fill('Lab Pixel Harness')
    await page.locator('input[name="email"]').fill('lab.pixel@example.com')
    await page.locator('input[name="phone"]').fill('0999999999')
    const motivo = page.locator('select[name="motivo"]')
    if (await motivo.count()) await motivo.selectOption({ index: 1 })
    const consent = page.locator('input[name="consent"]')
    if (!(await consent.isChecked())) await consent.check()
    await page.getByRole('button', { name: /^Enviar$/i }).click()
    await page.waitForTimeout(4000)

    const leadReq = leadBodies[leadApiBefore] || leadBodies.at(-1)
    const trLead = eventRequests
      .slice(trBeforeLead)
      .filter((e) => e.channel === 'tr' && e.ev === 'Lead')
      .at(-1)
    const leadApi = apiSimulated.filter((a) => a.path === '/api/tour/lead').at(-1)

    report.lead = {
      form_submitted: Boolean(leadReq),
      api_meta_event_id: leadApi?.response?.meta_event_id || null,
      tr_eid: trLead?.eid || null,
      tr_dl: trLead?.dl || null,
      tr_rl: trLead?.rl || null,
      shared_event_id: Boolean(
        leadApi?.response?.meta_event_id &&
          trLead?.eid &&
          leadApi.response.meta_event_id === trLead.eid,
      ),
      simulated_no_contact: Boolean(leadApi?.response?.simulated),
      no_manual_fbq: true,
    }

    // ——— checks ———
    const restricted = []
    for (const e of eventRequests.filter((x) => x.channel === 'tr')) {
      restricted.push(assertNoRestricted(`tr.${e.ev}.dl`, e.dl))
      restricted.push(assertNoRestricted(`tr.${e.ev}.rl`, e.rl))
      restricted.push(assertNoRestricted(`tr.${e.ev}.page_url`, e.page_url))
    }
    if (enqueueVc?.event_source_url) {
      restricted.push(assertNoRestricted('enqueue.event_source_url', enqueueVc.event_source_url))
    }
    report.restricted_checks = restricted

    const spaOk =
      report.spa_nav.client_nav_ok &&
      report.spa_nav.no_events_on_excluded_route &&
      report.spa_nav.not_retained_on_return &&
      Boolean(report.spa_nav.return_pageview)
    const vcOk = report.viewcontent.shared_event_id && report.viewcontent.unit_id_matches
    const leadOk = report.lead.shared_event_id && report.lead.simulated_no_contact
    const restrictedOk = restricted.every((r) => r.ok)
    const hostOk = await page.evaluate((d) => location.hostname === d, HARNESS_DOMAIN)

    const ok =
      spaOk &&
      vcOk &&
      leadOk &&
      restrictedOk &&
      hostOk &&
      fbeventsLoaded.length > 0 &&
      configServedLocal.length > 0

    report.verdict = ok ? 'compatible' : 'bloqueo'
    report.pixel_compatible = ok
    report.pixel_approved = false
    report.measurement_aborted_tr = eventRequests.filter((e) => e.channel === 'tr').length
    report.api_simulated_summary = {
      enqueue: apiSimulated.filter((a) => a.path === '/api/meta/enqueue').length,
      lead: apiSimulated.filter((a) => a.path === '/api/tour/lead').length,
    }

    if (!ok) {
      const blockers = []
      if (!spaOk) blockers.push('spa_nav_or_exclusion')
      if (!vcOk) blockers.push('viewcontent_ui_or_eid')
      if (!leadOk) blockers.push('lead_form_or_eid')
      if (!restrictedOk) blockers.push('restricted_info')
      if (!hostOk) blockers.push('hostname')
      if (!fbeventsLoaded.length) blockers.push('no_fbevents')
      report.limit = blockers.join('; ')
    } else {
      report.limit =
        'Lab compatible (SPA + ficha/form reales). Sin publish. CAPI live conservador intacto.'
      report.activation_plan = {
        note: 'Desplegar con SIMULATE=false ya habilita el Pixel para visitantes con consentimiento. No hay una segunda “activación” posterior.',
        deploy: [
          '1. Merge del PR → deploy Frontend a Production.',
          '2. Env Production: NEXT_PUBLIC_META_PIXEL_ID=923439043758658, NEXT_PUBLIC_META_PIXEL_SIMULATE=false, NEXT_PUBLIC_COOKIE_BANNER_ENABLED=true, NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE=true (política acordada). Nest CAPI live conservador sin cambios.',
          '3. Tras el deploy, el Pixel queda activo para quien acepte medición (consent grant + rutas públicas).',
          '4. Smoke de solo lectura en Events Manager (PageView consentido). No fabricar leads de prueba en producción.',
        ],
        rollback: [
          'A. NEXT_PUBLIC_META_PIXEL_SIMULATE=true o retirar NEXT_PUBLIC_META_PIXEL_ID → redeploy Frontend.',
          'B. Revocar medición en el banner detiene el Pixel de inmediato sin redeploy.',
          'C. Nest CAPI: mantener live conservador; no alterar lane salvo decisión explícita.',
        ],
      }
    }

    console.log(JSON.stringify({ report }, null, 2))
    if (!ok) process.exitCode = 1
  } catch (error) {
    report.verdict = 'bloqueo'
    report.limit = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ report }, null, 2))
    process.exitCode = 1
  } finally {
    await browser.close().catch(() => {})
    next.kill('SIGTERM')
    setTimeout(() => {
      try {
        next.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, 4000).unref?.()
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ verdict: 'bloqueo', limit: String(error?.message || error) }))
  process.exitCode = 1
})
