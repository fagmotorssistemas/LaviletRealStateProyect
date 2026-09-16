/**
 * Pruebas UNITARIAS con stub fbq (META_PIXEL_SIMULATE).
 * No generan tráfico real a Meta: solo inspeccionan args en __lvMetaPixelLog.
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import path from 'node:path'
import Module from 'node:module'

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

function installWindow(pathname: string, origin = 'https://www.lavilett.com') {
  const store: { cookie: string } = { cookie: '' }
  const scripts: Array<{ src: string }> = []
  ;(globalThis as { window?: unknown }).window = {
    location: { pathname, origin, href: `${origin}${pathname}` },
    __lvMetaPixelLog: [] as LogEntry[],
  }
  ;(globalThis as { document?: unknown }).document = {
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
  return { scripts }
}

function setPath(pathname: string, origin = 'https://www.lavilett.com') {
  const w = globalThis.window as { location: { pathname: string; origin: string; href: string } }
  w.location.pathname = pathname
  w.location.origin = origin
  w.location.href = `${origin}${pathname}`
}

function loadPixelModule() {
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

function fbqLog() {
  return (globalThis.window as { __lvMetaPixelLog: LogEntry[] }).__lvMetaPixelLog
}

describe('Meta Pixel — unitarias (stub fbq, sin red)', () => {
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

  it('unit: autoConfig=false antes de init; ViewContent sin mount no se pierde', () => {
    const consent = loadConsentModule()
    consent.writeAdsConsentCookie('full')
    const pixel = loadPixelModule()

    const eventId = '11111111-1111-4111-8111-111111111111'
    pixel.trackMetaPixelEvent('ViewContent', undefined, eventId)

    const log = fbqLog()
    assert.ok(log.some((e) => e.args[0] === 'set' && e.args[1] === 'autoConfig' && e.args[2] === false))
    assert.ok(log.some((e) => e.args[0] === 'init'))
    const track = log.find((e) => e.args[0] === 'track' && e.args[1] === 'ViewContent')
    assert.equal((track?.args[3] as { eventID: string }).eventID, eventId)
  })

  it('unit: aceptar medición en /simulador no hace init ni carga Pixel', () => {
    installWindow('/simulador')
    const consent = loadConsentModule()
    consent.writeAdsConsentCookie('full')
    const pixel = loadPixelModule()

    pixel.applyMetaPixelAdsConsent(true)
    assert.equal(pixel.canBootstrapMetaPixel('/simulador'), false)
    assert.equal(pixel.ensureMetaPixel(), false)

    const log = fbqLog()
    assert.equal(
      log.filter((e) => e.args[0] === 'init').length,
      0,
      'no init en /simulador',
    )
    pixel.trackMetaPixelEvent('PageView')
    assert.equal(log.filter((e) => e.args[0] === 'track').length, 0)
  })

  it('unit: tour → /simulador con Pixel previo → consent revoke (pausa)', () => {
    const consent = loadConsentModule()
    consent.writeAdsConsentCookie('full')
    const pixel = loadPixelModule()

    pixel.applyMetaPixelAdsConsent(true)
    pixel.trackMetaPixelEvent('PageView')
    assert.ok(fbqLog().some((e) => e.args[0] === 'init'))

    setPath('/simulador')
    pixel.syncMetaPixelToRoute('/simulador')

    const log = fbqLog()
    assert.ok(log.some((e) => e.args[0] === 'consent' && e.args[1] === 'revoke'))
    const before = log.length
    pixel.trackMetaPixelEvent('PageView')
    assert.equal(fbqLog().length, before)
  })

  it('unit: revocar ads y eventID compartido con CAPI', () => {
    const consent = loadConsentModule()
    consent.writeAdsConsentCookie('full')
    const pixel = loadPixelModule()
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    pixel.trackMetaPixelEvent('Lead', {}, id)
    const track = fbqLog().find((e) => e.args[0] === 'track' && e.args[1] === 'Lead')
    assert.equal((track?.args[3] as { eventID: string }).eventID, id)

    consent.writeAdsConsentCookie('denied')
    pixel.applyMetaPixelAdsConsent(false)
    assert.ok(fbqLog().some((e) => e.args[0] === 'consent' && e.args[1] === 'revoke'))
    const before = fbqLog().length
    pixel.trackMetaPixelEvent('Lead', {}, id)
    assert.equal(fbqLog().length, before)
  })
})
