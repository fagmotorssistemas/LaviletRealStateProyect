/**
 * Pixel behavior: interceptación local (sin red a Meta).
 * Cubre autoConfig, rutas excluidas, ViewContent pre-init y revocación.
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import path from 'node:path'
import Module from 'node:module'

// Resolver alias @/ como en Next (test-typescript.cjs no lo hace).
const srcRoot = path.resolve(__dirname, '../..')
const origResolve = (Module as NodeModule & { _resolveFilename: Function })._resolveFilename
;(Module as NodeModule & { _resolveFilename: Function })._resolveFilename = function (
  request: string,
  parent: NodeModule,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith('@/')) {
    return origResolve.call(this, path.join(srcRoot, request.slice(2)), parent, isMain, options)
  }
  return origResolve.call(this, request, parent, isMain, options)
}

type LogEntry = { at: string; args: unknown[] }
type NetEntry = { at: string; url: string; kind: string }

function installWindow(pathname: string, origin = 'https://www.lavilett.com') {
  const store: { cookie: string } = { cookie: '' }
  const scripts: Array<{ src: string; dataset: Record<string, string> }> = []
  ;(globalThis as { window?: unknown; document?: unknown }).window = {
    location: { pathname, origin, href: `${origin}${pathname}` },
    __lvMetaPixelLog: [] as LogEntry[],
    __lvMetaPixelNetwork: [] as NetEntry[],
  }
  ;(globalThis as { document?: unknown }).document = {
    cookie: '',
    get cookie() {
      return store.cookie
    },
    set cookie(v: string) {
      const [pair] = String(v).split(';')
      const [name, ...rest] = pair.split('=')
      const value = rest.join('=')
      const parts = store.cookie
        ? store.cookie.split('; ').filter((p) => !p.startsWith(`${name}=`))
        : []
      parts.push(`${name}=${value}`)
      store.cookie = parts.join('; ')
    },
    querySelector: () => null,
    createElement: (tag: string) => {
      if (tag !== 'script') return {}
      const el = { src: '', dataset: {} as Record<string, string>, async: false }
      scripts.push(el)
      return el
    },
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
  }
  Object.defineProperty(globalThis, 'document', {
    value: (globalThis as { document: unknown }).document,
    configurable: true,
  })
  // mirror document.cookie onto window for consent helpers that read document
  return { scripts, store }
}

function setPath(pathname: string, origin = 'https://www.lavilett.com') {
  const w = globalThis.window as { location: { pathname: string; origin: string; href: string } }
  w.location.pathname = pathname
  w.location.origin = origin
  w.location.href = `${origin}${pathname}`
}

function loadPixelModule() {
  // Fresh module each test (env + window)
  const key = require.resolve('./metaPixel')
  const consentKey = require.resolve('../tour/consent')
  delete require.cache[key]
  delete require.cache[consentKey]
  return require('./metaPixel') as typeof import('./metaPixel')
}

function loadConsentModule() {
  const key = require.resolve('../tour/consent')
  const pixelKey = require.resolve('./metaPixel')
  delete require.cache[key]
  delete require.cache[pixelKey]
  return require('../tour/consent') as typeof import('../tour/consent')
}

describe('Meta Pixel — interceptación local', () => {
  const prevSim = process.env.NEXT_PUBLIC_META_PIXEL_SIMULATE
  const prevId = process.env.NEXT_PUBLIC_META_PIXEL_ID
  const prevBanner = process.env.NEXT_PUBLIC_COOKIE_BANNER_ENABLED

  beforeEach(() => {
    process.env.NEXT_PUBLIC_META_PIXEL_SIMULATE = 'true'
    process.env.NEXT_PUBLIC_META_PIXEL_ID = '923439043758658'
    process.env.NEXT_PUBLIC_COOKIE_BANNER_ENABLED = 'true'
    installWindow('/tour')
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_META_PIXEL_SIMULATE = prevSim
    process.env.NEXT_PUBLIC_META_PIXEL_ID = prevId
    process.env.NEXT_PUBLIC_COOKIE_BANNER_ENABLED = prevBanner
    delete (globalThis as { window?: unknown }).window
  })

  it('autoConfig=false antes de init; ViewContent no se pierde sin mount previo', () => {
    const consent = loadConsentModule()
    consent.writeAdsConsentCookie('full')
    const pixel = loadPixelModule()

    // Sin llamar MetaPixel.tsx: solo track (caso ficha abierta antes del effect)
    const eventId = '11111111-1111-4111-8111-111111111111'
    pixel.trackMetaPixelEvent('ViewContent', undefined, eventId)

    const log = (globalThis.window as { __lvMetaPixelLog: LogEntry[] }).__lvMetaPixelLog
    const cmds = log.map((e) => e.args[0])
    assert.ok(cmds.includes('set'))
    assert.ok(cmds.includes('init'))
    assert.ok(cmds.includes('track'))

    const setCall = log.find((e) => e.args[0] === 'set')
    assert.deepEqual(setCall?.args.slice(0, 3), ['set', 'autoConfig', false])

    const track = log.find((e) => e.args[0] === 'track' && e.args[1] === 'ViewContent')
    assert.ok(track)
    assert.equal((track!.args[3] as { eventID: string }).eventID, eventId)

    const net = (globalThis.window as { __lvMetaPixelNetwork: NetEntry[] }).__lvMetaPixelNetwork
    const tr = net.find((n) => n.kind === 'pixel_tr_simulated')
    assert.ok(tr?.url.includes('ev=ViewContent'))
    assert.ok(tr?.url.includes(`eid=${eventId}`))
    assert.ok(tr?.url.includes('dl=https%3A%2F%2Fwww.lavilett.com%2Ftour') || tr?.url.includes('/tour'))
    assert.equal(
      net.some((n) => n.kind === 'script' && n.url.includes('fbevents.js')),
      false,
      'simulate no debe cargar fbevents.js',
    )
  })

  it('tour → /simulador: no PageView ni track en ruta excluida', () => {
    const consent = loadConsentModule()
    consent.writeAdsConsentCookie('full')
    const pixel = loadPixelModule()

    pixel.trackMetaPixelEvent('PageView')
    let log = (globalThis.window as { __lvMetaPixelLog: LogEntry[] }).__lvMetaPixelLog
    assert.ok(log.some((e) => e.args[0] === 'track' && e.args[1] === 'PageView'))

    // Navegación a simulador
    setPath('/simulador')
    ;(globalThis.window as { __lvMetaPixelLog: LogEntry[] }).__lvMetaPixelLog = []
    ;(globalThis.window as { __lvMetaPixelNetwork: NetEntry[] }).__lvMetaPixelNetwork = []

    pixel.trackMetaPixelEvent('PageView')
    pixel.trackMetaPixelEvent('ViewContent', undefined, '22222222-2222-4222-8222-222222222222')

    log = (globalThis.window as { __lvMetaPixelLog: LogEntry[] }).__lvMetaPixelLog
    assert.equal(
      log.filter((e) => e.args[0] === 'track').length,
      0,
      'no tracks en /simulador',
    )
    assert.equal(pixel.isMetaPublicPath('/simulador'), false)
    assert.equal(pixel.isMetaExcludedPath('/simulador'), true)
  })

  it('revocar consentimiento: consent revoke y no más tracks', () => {
    const consent = loadConsentModule()
    consent.writeAdsConsentCookie('full')
    const pixel = loadPixelModule()
    pixel.applyMetaPixelAdsConsent(true)
    pixel.trackMetaPixelEvent('PageView')

    consent.writeAdsConsentCookie('denied')
    pixel.applyMetaPixelAdsConsent(false)

    const log = (globalThis.window as { __lvMetaPixelLog: LogEntry[] }).__lvMetaPixelLog
    assert.ok(log.some((e) => e.args[0] === 'consent' && e.args[1] === 'revoke'))

    const before = log.length
    pixel.trackMetaPixelEvent('PageView')
    pixel.trackMetaPixelEvent('Lead', {}, '33333333-3333-4333-8333-333333333333')
    const after = (globalThis.window as { __lvMetaPixelLog: LogEntry[] }).__lvMetaPixelLog
    assert.equal(after.length, before, 'sin tracks tras revoke')
  })

  it('conserva eventID compartido con CAPI en options', () => {
    const consent = loadConsentModule()
    consent.writeAdsConsentCookie('full')
    const pixel = loadPixelModule()
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    pixel.trackMetaPixelEvent('Lead', {}, id)
    const track = (globalThis.window as { __lvMetaPixelLog: LogEntry[] }).__lvMetaPixelLog.find(
      (e) => e.args[0] === 'track' && e.args[1] === 'Lead',
    )
    assert.equal((track?.args[3] as { eventID: string }).eventID, id)
  })
})
