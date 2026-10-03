// Responsive showroom chrome: menu visible, controls on screen, no overlap, no horizontal scroll.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const base = process.env.SHOWROOM_URL || 'http://localhost:3000/tour'
const viewports = [
  { width: 360, height: 740, touch: true },
  { width: 375, height: 812, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 414, height: 896, touch: true },
  { width: 740, height: 360, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1024, height: 768, touch: true },
  { width: 1366, height: 768, touch: false },
  { width: 1920, height: 1080, touch: false },
]

function overlaps(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return x * y
}

async function readChrome(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.tour-root')
    const nodes = root ? [...root.querySelectorAll('button, a[href]')] : []
    const controls = []
    for (const el of nodes) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      if (style.pointerEvents === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const cx = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2))
      const cy = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2))
      const hit = document.elementFromPoint(cx, cy)
      if (!hit || (hit !== el && !el.contains(hit) && !hit.contains(el))) continue
      controls.push({
        name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
      })
    }
    const menu = document.querySelector('[data-showroom-menu]')
    const menuBox = menu ? menu.getBoundingClientRect() : null
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      rootScrollWidth: root ? root.scrollWidth : 0,
      rootClientWidth: root ? root.clientWidth : 0,
      coarse: window.matchMedia('(pointer: coarse)').matches,
      menu: menuBox ? { x: menuBox.left, y: menuBox.top, w: menuBox.width, h: menuBox.height, display: getComputedStyle(menu).display } : null,
      controls,
    }
  })
}

async function openPlan(page) {
  const cookies = page.getByRole('button', { name: 'Aceptar cookies' })
  if (await cookies.count()) await cookies.click().catch(() => undefined)
  await page.locator('[data-showroom-menu]').waitFor({ state: 'visible', timeout: 30000 })
  const enter = page.getByRole('button', { name: 'Ingresar', exact: true })
  if (await enter.count()) {
    assert.equal(await page.getByRole('link', { name: 'Volver a la página web' }).count(), 0)
    await enter.click()
    const skip = page.getByRole('button', { name: 'Saltar', exact: true })
    await skip.waitFor({ state: 'visible', timeout: 8000 })
    const box = await skip.boundingBox()
    assert.ok(box && box.y > page.viewportSize().height * 0.45, 'Saltar debe quedar en la mitad inferior')
    await skip.click()
    await page.getByRole('button', { name: 'Ingresar', exact: true }).waitFor({ state: 'hidden', timeout: 15000 })
  }
  await page.getByRole('button', { name: 'Terraza', exact: true }).waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(500)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.touch,
        isMobile: viewport.touch,
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await openPlan(page)
      const chrome = await readChrome(page)
      const label = `${viewport.width}x${viewport.height}`
      assert.ok(chrome.menu && chrome.menu.display !== 'none', `${label}: menú oculto`)
      assert.ok(chrome.menu.w >= 43 && chrome.menu.h >= 43, `${label}: menú ${chrome.menu.w}x${chrome.menu.h}`)
      assert.ok(chrome.menu.x >= -1 && chrome.menu.y >= -1 && chrome.menu.x + chrome.menu.w <= chrome.vw + 1 && chrome.menu.y + chrome.menu.h <= chrome.vh + 1, `${label}: menú fuera de pantalla`)
      assert.ok(chrome.scrollWidth <= chrome.clientWidth + 1, `${label}: scroll horizontal ${chrome.scrollWidth}>${chrome.clientWidth}`)
      const off = chrome.controls.filter((item) => item.x < -1 || item.y < -1 || item.x + item.w > chrome.vw + 1 || item.y + item.h > chrome.vh + 1)
      assert.deepEqual(off.map((item) => item.name), [], `${label}: controles fuera de pantalla`)
      const piled = []
      for (let i = 0; i < chrome.controls.length; i += 1) {
        for (let j = i + 1; j < chrome.controls.length; j += 1) {
          if (overlaps(chrome.controls[i], chrome.controls[j]) > 8) piled.push(`${chrome.controls[i].name} × ${chrome.controls[j].name}`)
        }
      }
      assert.deepEqual(piled, [], `${label}: controles encimados`)
      if (chrome.coarse) {
        const small = chrome.controls.filter((item) => item.w < 43 || item.h < 43)
        assert.deepEqual(small.map((item) => `${item.name} ${Math.round(item.w)}x${Math.round(item.h)}`), [], `${label}: controles bajo 44px`)
      }
      const terraza = chrome.controls.find((item) => item.name === 'Terraza')
      assert.equal(terraza ? 'Terraza' : '', 'Terraza')
      assert.equal(await page.getByRole('button', { name: 'Terraza', exact: true }).innerText(), 'T')
      assert.deepEqual(errors, [])
      await context.close()
      console.log('PASS', label, 'coarse=' + chrome.coarse, 'controls=' + chrome.controls.length)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
