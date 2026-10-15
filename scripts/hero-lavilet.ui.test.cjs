const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { chromium } = require('playwright')
const sharp = require('sharp')

const root = path.resolve(__dirname, '..')
const appUrl = process.env.HERO_TEST_URL || 'http://127.0.0.1:3102'

async function referenceServer() {
  const server = http.createServer(async (req, res) => {
    const name = req.url.split('?')[0]
    const file = name === '/reference' ? 'docs/hero-lavilet/referencia.html'
      : /^\/public\/hero\/[a-z-]+\.webp$/.test(name) ? name.slice(1) : null
    if (!file) { res.writeHead(404); res.end(); return }
    try {
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/webp')
      res.end(await fs.readFile(path.join(root, file)))
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${server.address().port}/reference` }
}

async function ready(page, url) {
  if (url.startsWith(appUrl)) await page.context().addCookies([{ name: 'lv_ads_consent', value: 'minimal', url: appUrl }])
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  if (url.startsWith(appUrl)) await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(Array.from(document.querySelectorAll('#inicio img, #hero img'), img => img.decode().catch(() => {})))
  })
  await page.waitForFunction(() => {
    const pin = document.querySelector('[data-part="pin"]') || document.getElementById('pin')
    const title = document.querySelector('[data-part="t"]') || document.getElementById('t')
    return pin?.style.getPropertyValue('--travel') && title?.children.length === 8
  })
  await page.waitForTimeout(300)
}

async function geometry(page, part) {
  return page.evaluate(part => {
    const el = document.querySelector(`[data-part="${part}"]`) || document.getElementById(part)
    if (!el) return null
    const { x, y, width, height } = el.getBoundingClientRect()
    return { x, y, width, height }
  }, part)
}

async function seek(page, p) {
  const top = await page.evaluate(p => {
    const pin = document.querySelector('[data-part="pin"]') || document.getElementById('pin')
    const hero = document.querySelector('[data-part="hero"]') || document.getElementById('hero')
    const top = Math.round(pin.getBoundingClientRect().top + scrollY + p * (pin.offsetHeight - hero.offsetHeight))
    window.scrollTo({ top, behavior: 'instant' })
    return top
  }, p)
  await page.waitForTimeout(900)
  return top
}

async function snapshot(page) {
  return page.evaluate(() => {
    const find = id => document.querySelector(`[data-part="${id}"]`) || document.getElementById(id)
    const describe = el => {
      const r = el.getBoundingClientRect(), css = getComputedStyle(el)
      return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: Number(css.opacity), color: css.color }
    }
    const parts = Object.fromEntries(['bld', 'ground', 'bgInner', 'walker', 'car', 'imgBgS', 'imgBgN', 'imgGroundS', 'imgGroundN', 'imgBldS', 'imgBldN', 'imgBldX', 'imgBldY', 'eye', 'claim', 'sub', 'sd', 'veil'].map(id => [id, describe(find(id))]))
    parts.letters = Array.from(find('t').children, describe)
    parts.words = Array.from(find('claim').querySelectorAll('i'), describe)
    parts.subLines = Array.from(find('sub').querySelectorAll('i'), describe)
    parts.walkFrames = parts.walker.opacity === 0 ? [] : Array.from(find('walker').querySelectorAll('img'), describe)
    return parts
  })
}

function compare(a, e, name) {
  // The reference leaves the last transform on actors after they become invisible.
  if (e.opacity === 0 && a.opacity === 0) return
  for (const key of Object.keys(e)) {
    if (typeof e[key] === 'object') { compare(a[key], e[key], `${name}.${key}`); continue }
    if (typeof e[key] === 'number') {
      const tolerance = key === 'opacity' ? 0.005 : 2
      assert.ok(Math.abs(a[key] - e[key]) <= tolerance, `${name}.${key}: ${a[key]} vs ${e[key]}`)
    } else assert.equal(a[key], e[key], `${name}.${key}`)
  }
}

async function comparePixels(actual, expected, name) {
  const a = await sharp(actual).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const e = await sharp(expected).removeAlpha().raw().toBuffer()
  let difference = 0, samples = 0
  // The approved navbar integration differs from the reference in the top band.
  for (let y = 85; y < a.info.height; y++) for (let x = 0; x < a.info.width; x++) {
    for (let c = 0; c < 3; c++) {
      const index = (y * a.info.width + x) * 3 + c
      difference += Math.abs(a.data[index] - e[index])
      samples++
    }
  }
  assert.ok(difference / samples < 0.25, `${name}: visible scene differs from the reference (${difference / samples})`)
}

test('home matches reference building, street and sky geometry at the top', { timeout: 180000 }, async () => {
  const reference = await referenceServer()
  const browser = await chromium.launch({ headless: true })
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'lavilet-hero-'))
  try {
    const context = await browser.newContext({ viewport: { width: 1329, height: 942 } })
    const actual = await context.newPage(), expected = await context.newPage()
    await Promise.all([ready(actual, `${appUrl}/inicio`), ready(expected, reference.url)])
    await actual.screenshot({ path: path.join(output, 'actual.png') })
    await expected.screenshot({ path: path.join(output, 'reference.png') })
    for (const part of ['bld', 'ground', 'bgInner']) {
      const a = await geometry(actual, part), e = await geometry(expected, part)
      assert.ok(a, `missing ${part} in home`)
      for (const dimension of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(a[dimension] - e[dimension]) <= 2, `${part}.${dimension}: ${a[dimension]} vs ${e[dimension]}`)
      }
    }
  } finally {
    console.log(`Hero comparison screenshots: ${output}`)
    await browser.close()
    await new Promise(resolve => reference.server.close(resolve))
  }
})

test('desktop navbar starts transparent and follows the hero instead of a timed entrance', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1329, height: 942 } })
    await ready(page, `${appUrl}/inicio`)
    const opacity = await page.locator('[data-site-header]').evaluate(el => getComputedStyle(el).opacity)
    assert.equal(Number(opacity), 0, 'the whole navbar, including its background, must start transparent')
    await seek(page, 0.25 / 0.95)
    const entrance = await page.locator('[data-site-header]').evaluate(header => {
      const parentOpacity = Number(getComputedStyle(header).opacity)
      return Array.from(header.querySelectorAll('[data-hero-nav-item]')).filter(el => el.getClientRects().length).slice(0, 3).map(el => ({
        opacity: parentOpacity * Number(getComputedStyle(el).opacity),
        y: new DOMMatrixReadOnly(getComputedStyle(el).transform).m42,
      }))
    })
    // Reference T=.25: the three staggered power2.out segments are .6975, .36 and 0.
    for (const [i, expected] of [0.6975, 0.36, 0].entries()) {
      assert.ok(Math.abs(entrance[i].opacity - expected) < 0.005)
      assert.ok(Math.abs(entrance[i].y - (-10 * (1 - expected))) < 0.1)
    }
    await seek(page, 0.5)
    const alignment = await page.evaluate(() => {
      const header = document.querySelector('[data-site-header]'), horizontal = document.querySelector('[data-part="pH"]'), underline = document.querySelector('[data-part="pU"]')
      const link = Array.from(header.querySelectorAll('nav a')).find(el => el.getClientRects().length)
      return { lineY: horizontal.getBoundingClientRect().y, bottom: header.getBoundingClientRect().bottom,
        underline: underline.getBoundingClientRect().toJSON(), link: link.getBoundingClientRect().toJSON() }
    })
    assert.ok(Math.abs(alignment.lineY - alignment.bottom) <= 1)
    assert.ok(Math.abs(alignment.underline.x - alignment.link.x) <= 1)
    assert.ok(Math.abs(alignment.underline.width - alignment.link.width) <= 1)
    assert.ok(Math.abs(alignment.underline.y - alignment.link.bottom - 2.5) <= 1)
    await page.locator('[data-site-header]').getByRole('link', { name: 'Contacto', exact: true }).click()
    await page.waitForURL('**/contacto')
    await page.waitForTimeout(700)
    assert.equal(await page.locator('[data-site-header]').getAttribute('data-hero-visible'), null)
    assert.equal(await page.locator('[data-site-header]').evaluate(el => el.style.getPropertyValue('--hero-header-opacity')), '')
    assert.equal(await page.locator('[data-site-header] [inert]').count(), 0)
  } finally { await browser.close() }
})

test('mobile navbar is usable from the start and hero control is released on other pages', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await ready(page, `${appUrl}/inicio`)
    const header = page.locator('[data-site-header]')
    assert.equal(Number(await header.evaluate(el => getComputedStyle(el).opacity)), 1)
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click()
    await page.getByRole('button', { name: 'Cerrar menú', exact: true }).waitFor()
    await header.getByRole('link', { name: 'Contacto', exact: true }).last().click()
    await page.waitForURL('**/contacto')
    await page.waitForTimeout(700)
    assert.equal(await page.locator('[data-part="pin"]').count(), 0)
    assert.equal(await header.getAttribute('data-hero-visible'), null)
    assert.equal(await header.evaluate(el => el.style.getPropertyValue('--hero-header-opacity')), '')
    assert.equal(await header.locator('[inert]').count(), 0)
    await header.getByRole('link', { name: 'La Vilet', exact: true }).click()
    await page.waitForURL('**/inicio')
    await page.waitForFunction(() => document.querySelector('[data-part="t"]')?.children.length === 8)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

test('scene, people and typography match reference at five scroll positions in all three viewports', { timeout: 180000 }, async () => {
  const reference = await referenceServer()
  const browser = await chromium.launch({ headless: true })
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'lavilet-hero-five-points-'))
  try {
    for (const viewport of [{ width: 1329, height: 942 }, { width: 1920, height: 963 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport })
      const actual = await context.newPage(), expected = await context.newPage()
      const errors = []
      actual.on('pageerror', error => errors.push(error.message))
      await Promise.all([ready(actual, `${appUrl}/inicio`), ready(expected, reference.url)])
      for (const [name, p] of [['day', 0], ['afternoon', 0.5], ['pedestrian', 0.6799], ['car', 0.7539], ['night', 1]]) {
        const [aScroll, eScroll] = await Promise.all([seek(actual, p), seek(expected, p)])
        assert.equal(aScroll, eScroll, 'reference and app must use the same scroll offset')
        const prefix = `${viewport.width}x${viewport.height}-${name}`
        const [aImage, eImage] = await Promise.all([actual.screenshot({ path: path.join(output, `${prefix}-actual.png`) }), expected.screenshot({ path: path.join(output, `${prefix}-reference.png`) })])
        compare(await snapshot(actual), await snapshot(expected), prefix)
        await comparePixels(aImage, eImage, prefix)
      }
      assert.deepEqual(errors, [])
      await context.close()
    }
  } finally {
    console.log(`Five-point hero screenshots: ${output}`)
    await browser.close()
    await new Promise(resolve => reference.server.close(resolve))
  }
})

test('car and pedestrian freeze without scroll and retrace the same positions on reverse scroll', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1329, height: 942 } })
    await ready(page, `${appUrl}/inicio`)
    for (const [actor, first, next] of [['walker', 0.67, 0.68], ['car', 0.75, 0.76]]) {
      await seek(page, first)
      const before = (await snapshot(page))[actor]
      assert.ok(before.opacity > 0, `${actor} must be visible`)
      await page.waitForTimeout(400)
      assert.deepEqual((await snapshot(page))[actor], before, `${actor} moves while scroll is stopped`)
      await seek(page, next)
      const moved = (await snapshot(page))[actor]
      assert.ok(Math.abs(moved.x - before.x) > 5, `${actor} must move with scroll`)
      await seek(page, first)
      assert.deepEqual((await snapshot(page))[actor], before, `${actor} must return to exactly the same point`)
    }
    await seek(page, 0.7539)
    const trail = page.locator('[data-part="car"] span').nth(2)
    assert.equal(Number(await trail.evaluate(el => getComputedStyle(el).opacity)), 0, 'car trail must disappear after settling')
  } finally { await browser.close() }
})

test('reduced motion shows the final night without pinning, extra travel, car or pedestrian', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    await ready(page, `${appUrl}/inicio`)
    const scene = await snapshot(page)
    for (const part of ['imgBgN', 'imgGroundN', 'imgBldN', 'imgBldY']) assert.equal(scene[part].opacity, 1)
    for (const part of ['car', 'walker', 'imgBldX']) assert.equal(scene[part].opacity, 0)
    const dimensions = await page.evaluate(() => {
      const hero = document.querySelector('[data-part="hero"]'), pin = document.querySelector('[data-part="pin"]')
      return { position: getComputedStyle(hero).position, hero: hero.clientHeight, pin: pin.clientHeight }
    })
    assert.notEqual(dimensions.position, 'sticky')
    assert.equal(dimensions.pin, dimensions.hero)
    assert.equal(Number(await page.locator('[data-site-header]').evaluate(el => getComputedStyle(el).opacity)), 1)
  } finally { await browser.close() }
})
