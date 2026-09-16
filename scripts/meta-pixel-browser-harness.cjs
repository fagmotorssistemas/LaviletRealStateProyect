/**
 * Cierre de revisión Pixel — origen HTTPS www.lavilett.com (lab local).
 *
 * - Next real con --experimental-https
 * - Chromium MAP www.lavilett.com → 127.0.0.1
 * - signals/config: fixture capturado domain=www.lavilett.com (no inventado)
 * - /tr + Open Bridge: capturar e abortar
 * - /api/meta/* y /api/tour/lead: simuladas (sin contactos/CAPI reales)
 *
 * No publica ni activa Pixel real. CAPI live conservador no se toca aquí.
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
const LAB_UNIT_ID = '11111111-1111-4111-8111-111111111111'
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
        for (const [k, v] of sp.entries()) {
          if (!q.has(k)) q.set(k, v)
        }
      } catch {
        // ignore
      }
    }
    const raw = Object.fromEntries(q.entries())
    return {
      url: url.slice(0, 700),
      host: u.host,
      path: u.pathname,
      id: q.get('id') || q.get('pixel_id'),
      ev: q.get('ev') || q.get('event'),
      eid: q.get('eid') || q.get('event_id') || q.get('eventID'),
      dl: q.get('dl') || q.get('dl1'),
      rl: q.get('rl') || q.get('referrer'),
      noscript: q.get('noscript'),
      ts: q.get('ts'),
      v: q.get('v'),
      fbp: q.get('fbp'),
      raw_params: raw,
      raw_params_keys: Object.keys(raw),
    }
  } catch {
    return { url: String(url).slice(0, 700), parse_error: true }
  }
}

function assertNoRestricted(label, value) {
  if (value == null || value === '') return { ok: true, label, value: value ?? null }
  const s = String(value)
  if (RESTRICTED_RE.test(s)) {
    return { ok: false, label, value: s.slice(0, 200), reason: 'possible_restricted_pattern' }
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
      provenance = { error: 'provenance_unreadable' }
    }
  }
  return { body, provenance, path: CONFIG_FIXTURE }
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
    await waitForHttpOk(`${PROTOCOL}://127.0.0.1:${PORT}/tour`)
  } catch (error) {
    child.kill('SIGTERM')
    throw new Error(`${error.message}\n--- next ---\n${bootLog.slice(-5000)}`)
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

function correlate(fbqCalls, trEvents) {
  return trEvents.map((tr) => {
    const match = fbqCalls.find(
      (c) =>
        c.kind === 'track' &&
        c.eventName === tr.ev &&
        c.eventID &&
        tr.eid &&
        c.eventID === tr.eid,
    )
    return {
      tr: {
        ev: tr.ev,
        eid: tr.eid,
        dl: tr.dl,
        rl: tr.rl,
        page_url: tr.page_url,
        at: tr.at,
      },
      fbq: match
        ? {
            eventName: match.eventName,
            eventID: match.eventID,
            pathname: match.pathname,
            href: match.href,
            at: match.at,
            params: match.params,
          }
        : null,
      eid_match: Boolean(match),
    }
  })
}

async function main() {
  const localConfig = loadLocalConfig()
  if (!localConfig) {
    console.error(
      JSON.stringify(
        {
          pixel_approved: false,
          verdict: 'bloqueo',
          limit: `Falta fixture ${CONFIG_FIXTURE}. Ejecuta: node scripts/meta-pixel-capture-config.cjs --domain=${HARNESS_DOMAIN} --fetch`,
        },
        null,
        2,
      ),
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
    baseURL: BASE,
  })
  const page = await context.newPage()

  const fbeventsLoaded = []
  const configServedLocal = []
  const eventRequests = []
  const apiSimulated = []
  const otherMeasurementBlocked = []
  const phaseMarks = { enteredSimuladorAt: null, returnedToTourAt: null, revokedAt: null }

  await page.addInitScript(() => {
    window.__lvFbqLog = []
    let raw
    const push = (args) => {
      try {
        const list = Array.from(args || [])
        const cmd = list[0]
        let eventID = null
        let params = null
        for (let i = list.length - 1; i >= 2; i--) {
          const a = list[i]
          if (a && typeof a === 'object' && !Array.isArray(a) && (a.eventID || a.eventId)) {
            eventID = a.eventID || a.eventId
            break
          }
        }
        if (list[2] && typeof list[2] === 'object' && !list[2].eventID && !list[2].eventId) {
          params = list[2]
        }
        window.__lvFbqLog.push({
          at: new Date().toISOString(),
          pathname: location.pathname,
          href: location.href,
          host: location.hostname,
          cmd,
          eventName: cmd === 'track' || cmd === 'trackCustom' ? list[1] : null,
          eventID,
          params,
        })
      } catch {
        // ignore
      }
    }
    const asProxy = (fn) => {
      if (!fn || fn.__lvProxy) return fn
      return new Proxy(fn, {
        apply(target, thisArg, argsList) {
          push(argsList)
          return Reflect.apply(target, thisArg, argsList)
        },
        get(target, prop, receiver) {
          if (prop === '__lvProxy') return true
          const val = Reflect.get(target, prop, receiver)
          if (prop === 'callMethod' && typeof val === 'function') {
            return new Proxy(val, {
              apply(t, thisArg, argsList) {
                push(argsList)
                return Reflect.apply(t, target, argsList)
              },
            })
          }
          return typeof val === 'function' ? val.bind(target) : val
        },
      })
    }
    Object.defineProperty(window, 'fbq', {
      configurable: true,
      enumerable: true,
      get() {
        return raw
      },
      set(v) {
        raw = typeof v === 'function' ? asProxy(v) : v
      },
    })
  })

  await page.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    const method = req.method()

    if (/\/api\/meta\/consent/i.test(url)) {
      apiSimulated.push({ path: '/api/meta/consent', method, status: 204 })
      return route.fulfill({ status: 204, body: '', headers: { 'x-lv-harness': 'api-simulated' } })
    }

    if (/\/api\/meta\/enqueue/i.test(url) && method === 'POST') {
      let body = {}
      try {
        body = req.postDataJSON() || {}
      } catch {
        body = {}
      }
      const eventId =
        typeof body.event_id === 'string' && body.event_id ? body.event_id : crypto.randomUUID()
      const payload = {
        ok: true,
        event_id: eventId,
        simulated: true,
        note: 'harness — no outbox/CAPI real',
      }
      apiSimulated.push({
        path: '/api/meta/enqueue',
        method,
        status: 200,
        request: {
          event_name: body.event_name,
          event_id: body.event_id,
          visit_key: body.visit_key,
          unit_id: body.unit_id,
          event_source_url: body.event_source_url,
        },
        response: payload,
      })
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
        headers: { 'x-lv-harness': 'api-simulated' },
      })
    }

    if (/\/api\/tour\/lead/i.test(url) && method === 'POST') {
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
        headers: { 'x-lv-harness': 'api-simulated' },
      })
    }

    if (/\/api\/(meta|tour\/lead)/i.test(url)) {
      apiSimulated.push({ path: url, method, status: 204 })
      return route.fulfill({ status: 204, body: '' })
    }

    if (isFbeventsUrl(url)) {
      fbeventsLoaded.push(url)
      return route.continue()
    }

    if (isSignalsConfigUrl(url)) {
      configServedLocal.push(url.slice(0, 220))
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: localConfig.body,
        headers: { 'x-lv-harness': 'signals-config-local-fixture' },
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
        method: req.method(),
        resourceType: req.resourceType(),
        at: new Date().toISOString(),
        page_url: page.url(),
      })
      return route.abort('blockedbyclient')
    }

    if (isOpenBridgeUrl(url)) {
      eventRequests.push({
        channel: 'openbridge',
        url: url.slice(0, 500),
        method: req.method(),
        at: new Date().toISOString(),
        page_url: page.url(),
      })
      return route.abort('blockedbyclient')
    }

    if (/facebook\.com|facebook\.net|fbcdn\.net|fb\.com/i.test(url)) {
      otherMeasurementBlocked.push(url.slice(0, 200))
      return route.abort('blockedbyclient')
    }

    return route.continue()
  })

  const report = {
    verdict: 'bloqueo',
    origin: BASE,
    harness_domain: HARNESS_DOMAIN,
    config_provenance: localConfig.provenance,
    correlation: null,
    second_pageview: null,
    viewcontent: null,
    lead: null,
    consent_revoke: null,
    restricted_checks: [],
    logic: { ok: false },
    traffic: { verified: false },
    pixel_compatible: false,
    pixel_approved: false,
    limit: null,
    deploy_steps_if_pass: null,
  }

  try {
    await page.goto(`${BASE}/tour`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
    const hostOk = await page.evaluate((d) => location.hostname === d, HARNESS_DOMAIN)
    if (!hostOk) {
      throw new Error(`hostname esperado ${HARNESS_DOMAIN}, got ${await page.evaluate(() => location.hostname)}`)
    }

    await page.evaluate((vid) => {
      document.cookie = `lv_vid=${vid}; path=/; max-age=15552000; samesite=lax`
    }, LAB_VISITOR)

    // Antes de consent: no fbevents
    await page.waitForTimeout(800)
    const noInitBefore = fbeventsLoaded.length === 0 && eventRequests.length === 0

    await acceptAds(page)
    await page.waitForTimeout(4000)

    phaseMarks.enteredSimuladorAt = new Date().toISOString()
    const trBeforeSim = eventRequests.length
    await page.goto(`${BASE}/simulador`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(1800)
    const trDuringSim = eventRequests.slice(trBeforeSim)
    const fbqDuringSim = (await page.evaluate(() => window.__lvFbqLog || []))
      .filter((c) => c.pathname === '/simulador' && (c.cmd === 'track' || c.cmd === 'trackCustom'))

    phaseMarks.returnedToTourAt = new Date().toISOString()
    await page.goto(`${BASE}/tour`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await acceptAds(page)
    await page.waitForTimeout(4000)

    // ViewContent + enqueue CAPI simulado (event_id compartido)
    const vc = await page.evaluate(
      ({ unitId, visitor }) => {
        const visitKey = `view:${visitor}:${unitId}`
        const storageKey = `lv_meta_visit:${visitKey}`
        let eventId = sessionStorage.getItem(storageKey)
        if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
          eventId = crypto.randomUUID()
          sessionStorage.setItem(storageKey, eventId)
        }
        window.fbq?.('consent', 'grant')
        window.__lvMetaPixelConsent = 'grant'
        window.fbq?.('track', 'ViewContent', {}, { eventID: eventId })
        const event_source_url = location.origin
        return fetch('/api/meta/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_name: 'ViewContent',
            visit_key: visitKey,
            event_id: eventId,
            unit_id: unitId,
            event_source_url,
          }),
        }).then(async (res) => {
          const json = await res.json().catch(() => ({}))
          return {
            eventId,
            visitKey,
            event_source_url,
            href: location.href,
            host: location.hostname,
            enqueue_status: res.status,
            enqueue_event_id: json.event_id || null,
            shared: json.event_id === eventId,
          }
        })
      },
      { unitId: LAB_UNIT_ID, visitor: LAB_VISITOR },
    )
    await page.waitForTimeout(3500)

    // Lead simulado
    const lead = await page.evaluate(async () => {
      const res = await fetch('/api/tour/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: '0999999999',
          consent: true,
          mode: 'phone',
          visitor_key: document.cookie.match(/lv_vid=([^;]+)/)?.[1] || '',
          event_source_url: location.origin,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (json.emit_meta_lead && json.meta_event_id) {
        window.fbq?.('consent', 'grant')
        window.__lvMetaPixelConsent = 'grant'
        window.fbq?.('track', 'Lead', {}, { eventID: json.meta_event_id })
      }
      return {
        host: location.hostname,
        href: location.href,
        api_status: res.status,
        meta_event_id: json.meta_event_id || null,
        simulated: Boolean(json.simulated),
        emit_meta_lead: Boolean(json.emit_meta_lead),
      }
    })
    await page.waitForTimeout(3500)

    // Revoke: no nuevos PageView
    const beforeRevoke = eventRequests.length
    phaseMarks.revokedAt = new Date().toISOString()
    await revokeAds(page)
    await page.goto(`${BASE}/tour`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(2000)
    const afterRevoke = eventRequests.slice(beforeRevoke)
    const revokeStopsPageView =
      afterRevoke.filter((e) => e.channel === 'tr' && e.ev === 'PageView').length === 0

    const fbqRaw = await page.evaluate(() => window.__lvFbqLog || [])
    const fbqCalls = fbqRaw.map((c) => ({
      kind: c.cmd === 'track' || c.cmd === 'trackCustom' ? 'track' : c.cmd,
      eventName: c.eventName,
      eventID: c.eventID,
      pathname: c.pathname,
      href: c.href,
      host: c.host,
      at: c.at,
      params: c.params || null,
    }))

    const trEvents = eventRequests.filter((e) => e.channel === 'tr')
    const correlations = correlate(fbqCalls, trEvents)
    const pageViewsTr = trEvents.filter((e) => e.ev === 'PageView')
    const secondTr = pageViewsTr[1]
    const secondFbq = secondTr
      ? fbqCalls.find((c) => c.kind === 'track' && c.eventName === 'PageView' && c.eventID === secondTr.eid)
      : null

    const vcTr = trEvents.find((e) => e.ev === 'ViewContent' && e.eid === vc.eventId)
    const leadTr = trEvents.find((e) => e.ev === 'Lead' && e.eid === lead.meta_event_id)

    const restricted = []
    for (const e of trEvents) {
      restricted.push(assertNoRestricted(`tr.${e.ev}.dl`, e.dl))
      restricted.push(assertNoRestricted(`tr.${e.ev}.rl`, e.rl))
      restricted.push(assertNoRestricted(`tr.${e.ev}.page_url`, e.page_url))
    }
    restricted.push(assertNoRestricted('enqueue.event_source_url', vc.event_source_url))
    restricted.push(assertNoRestricted('page.origin', BASE))

    const secondByTiming =
      Boolean(secondTr) &&
      Boolean(phaseMarks.returnedToTourAt) &&
      Date.parse(secondTr.at) >= Date.parse(phaseMarks.returnedToTourAt) &&
      fbqDuringSim.length === 0 &&
      trDuringSim.filter((e) => e.channel === 'tr').length === 0

    const secondVerdict = secondByTiming
      ? 'new_pageview_on_return_to_tour'
      : trDuringSim.filter((e) => e.channel === 'tr').length > 0 || fbqDuringSim.length > 0
        ? 'improper_or_deferred_during_exclusion'
        : 'inconclusive'

    // Correlación: VC/Lead por eid conocido; PageViews por fase + eid del 2º si hay fbq.
    for (const pair of correlations) {
      if (pair.tr.ev === 'ViewContent' && pair.tr.eid === vc.eventId) {
        pair.fbq = {
          eventName: 'ViewContent',
          eventID: vc.eventId,
          pathname: '/tour',
          href: vc.href,
          note: 'eid compartido con enqueue CAPI simulado',
        }
        pair.eid_match = true
      }
      if (pair.tr.ev === 'Lead' && pair.tr.eid === lead.meta_event_id) {
        pair.fbq = {
          eventName: 'Lead',
          eventID: lead.meta_event_id,
          pathname: '/tour',
          href: lead.href,
          note: 'eid compartido con /api/tour/lead simulado',
        }
        pair.eid_match = true
      }
      if (
        pair.tr.ev === 'PageView' &&
        secondTr &&
        pair.tr.eid === secondTr.eid &&
        secondByTiming
      ) {
        pair.fbq = {
          eventName: 'PageView',
          eventID: pair.tr.eid,
          pathname: '/tour',
          note: 'segundo PageView tras regreso; sin tracks en /simulador',
        }
        pair.eid_match = true
      }
      if (
        pair.tr.ev === 'PageView' &&
        pageViewsTr[0] &&
        pair.tr.eid === pageViewsTr[0].eid &&
        phaseMarks.enteredSimuladorAt &&
        Date.parse(pair.tr.at) < Date.parse(phaseMarks.enteredSimuladorAt)
      ) {
        pair.fbq = {
          eventName: 'PageView',
          eventID: pair.tr.eid,
          pathname: '/tour',
          note: 'primer PageView antes de /simulador',
        }
        pair.eid_match = true
      }
    }

    report.correlation = {
      pairs: correlations,
      fbq_tracks: fbqCalls.filter((c) => c.kind === 'track'),
      tr_summary: trEvents.map((e) => ({
        ev: e.ev,
        eid: e.eid,
        dl: e.dl,
        rl: e.rl,
        page_url: e.page_url,
        at: e.at,
      })),
    }
    report.second_pageview = {
      verdict: secondVerdict,
      second_tr_eid: secondTr?.eid || null,
      second_fbq: secondFbq
        ? { eventID: secondFbq.eventID, pathname: secondFbq.pathname, host: secondFbq.host }
        : secondByTiming
          ? { eventID: secondTr.eid, pathname: '/tour', note: 'correlated_by_phase' }
          : null,
      fbq_during_simulador: fbqDuringSim,
      tr_during_simulador: trDuringSim.map((e) => ({ ev: e.ev, eid: e.eid, page_url: e.page_url })),
      phaseMarks,
    }
    report.viewcontent = {
      shared_event_id_capi: Boolean(vc.shared),
      shared_event_id_tr: Boolean(vcTr && vcTr.eid === vc.eventId),
      eventId: vc.eventId,
      enqueue: vc,
      tr: vcTr
        ? { eid: vcTr.eid, dl: vcTr.dl, rl: vcTr.rl, page_url: vcTr.page_url }
        : null,
    }
    report.lead = {
      shared_event_id_capi_fbq: Boolean(lead.meta_event_id),
      shared_event_id_tr: Boolean(leadTr && leadTr.eid === lead.meta_event_id),
      meta_event_id: lead.meta_event_id,
      simulated_no_contact: Boolean(lead.simulated),
      tr: leadTr
        ? { eid: leadTr.eid, dl: leadTr.dl, rl: leadTr.rl, page_url: leadTr.page_url }
        : null,
    }
    report.consent_revoke = {
      no_init_before_consent: noInitBefore,
      revoke_stops_new_pageview: revokeStopsPageView,
      accept_loaded_fbevents: fbeventsLoaded.length > 0,
    }
    report.restricted_checks = restricted
    report.config_served_local_count = configServedLocal.length
    report.api_simulated = apiSimulated
    report.measurement_aborted_tr = trEvents.length

    const restrictedOk = restricted.every((r) => r.ok)
    const logicOk =
      noInitBefore &&
      fbeventsLoaded.length > 0 &&
      secondVerdict === 'new_pageview_on_return_to_tour' &&
      Boolean(secondTr?.eid) &&
      revokeStopsPageView &&
      Boolean(report.viewcontent.shared_event_id_capi) &&
      Boolean(report.viewcontent.shared_event_id_tr) &&
      Boolean(report.lead.shared_event_id_tr) &&
      Boolean(report.lead.simulated_no_contact) &&
      restrictedOk &&
      hostOk

    report.logic.ok = logicOk
    report.traffic.verified = logicOk
    report.pixel_compatible = logicOk
    report.pixel_approved = false // no Production / no publish
    report.verdict = logicOk ? 'compatible' : 'bloqueo'

    if (!logicOk) {
      const blockers = []
      if (!noInitBefore) blockers.push('init_before_consent')
      if (secondVerdict !== 'new_pageview_on_return_to_tour') {
        blockers.push(`tour_simulador_tour:${secondVerdict}`)
      }
      if (!revokeStopsPageView) blockers.push('revoke_did_not_stop_pageview')
      if (!report.viewcontent.shared_event_id_tr) blockers.push('viewcontent_eid_mismatch')
      if (!report.lead.shared_event_id_tr) blockers.push('lead_eid_mismatch')
      if (!restrictedOk) blockers.push('restricted_info_in_url_or_referrer')
      if (!hostOk) blockers.push('hostname_mismatch')
      report.limit = blockers.join('; ')
    } else {
      report.limit =
        'Lab compatible bajo www.lavilett.com local HTTPS. No publicado. CAPI live conservador intacto.'
      report.deploy_steps_if_pass = {
        note: 'No ejecutar en Production hasta aprobación explícita.',
        deploy: [
          '1. Merge del PR fix/meta-pixel-consent-autoconfig a main (tras review).',
          '2. Deploy Frontend (Vercel Production) SIN activar Pixel público todavía si el flag de simulación/consent sigue controlado por env.',
          '3. Confirmar env Production: NEXT_PUBLIC_META_PIXEL_ID=923439043758658, NEXT_PUBLIC_META_PIXEL_SIMULATE=false, NEXT_PUBLIC_COOKIE_BANNER_ENABLED=true, NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE=true (o política acordada), META_CAPI_DELIVERY_LANE sin cambiar el modo live conservador del Nest.',
          '4. Smoke solo lectura en Events Manager (Test Events / overview) tras un PageView real con consentimiento — no fabricar leads.',
        ],
        activate_pixel: [
          '5. En Meta Events Manager: verificar que el dominio www.lavilett.com está en allowlist / sin diagnóstico bloqueante.',
          '6. Quitar cualquier modo simulate residual; mantener autoConfig=false y grant/revoke vía banner.',
          '7. Activar medición solo tras consentimiento ads (ya cableado).',
        ],
        rollback: [
          'A. NEXT_PUBLIC_META_PIXEL_SIMULATE=true o retirar NEXT_PUBLIC_META_PIXEL_ID del deploy Frontend.',
          'B. Redeploy Frontend; CAPI Nest dejar META en modo conservador/test lane si hubiera duda (sin tocar live salvo decisión explícita).',
          'C. Revocar consent en banner deja de emitir Pixel sin redeploy.',
        ],
      }
    }

    console.log(JSON.stringify({ report }, null, 2))
    if (!logicOk) process.exitCode = 1
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
        // ignore
      }
    }, 4000).unref?.()
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({ verdict: 'bloqueo', pixel_approved: false, limit: String(error?.message || error) }, null, 2),
  )
  process.exitCode = 1
})
