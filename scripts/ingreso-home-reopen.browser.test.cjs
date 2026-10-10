/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS browser harness. */
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const base = process.env.SHOWROOM_URL || 'http://localhost:3000/tour'

async function waitForEnter(page, label) {
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Ingresar')
    return button?.classList.contains('opacity-100') && getComputedStyle(button).pointerEvents !== 'none'
  }, null, { timeout: 3200 })
  const elapsed = await page.evaluate(() => performance.now() - window.__homeAt)
  assert.ok(elapsed <= 3200, `${label}: readiness took ${elapsed}ms (2500ms timer plus scheduling tolerance)`)
  const enter = page.getByRole('button', { name: 'Ingresar', exact: true })
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Ingresar')
    return el && Number(getComputedStyle(el).opacity) > .9
  })
  await enter.click({ trial: true })
  assert.ok(await enter.evaluate(el => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && Number(getComputedStyle(el).opacity) > .9
  }), label + ': INGRESAR must be visible and receive the tap')
  console.log(`PASS ${label}: ready after ${Math.round(elapsed)}ms`)
  return elapsed
}

async function home(page) {
  await page.locator('[data-showroom-menu]').click()
  await page.getByRole('button', { name: 'Inicio / edificio', exact: true }).click()
}

async function main() {
  const browser = await chromium.launch()
  try {
    for (const scenario of [
      { width: 390, height: 844, touch: true, stalled: true },
      { width: 844, height: 390, touch: true, stalled: true },
      { width: 390, height: 844, touch: true, stalled: false },
      { width: 900, height: 700, touch: false, stalled: false },
    ]) {
      const { width, height, touch, stalled } = scenario
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      await page.addInitScript(blockCover => {
        document.addEventListener('click', event => {
          if (event.target.closest('button')?.textContent.trim() === 'Inicio / edificio') window.__homeAt = performance.now()
        }, true)
        if (!blockCover) return
        // No load/error/frame callback can rescue the button: exercise the fallback timer.
        const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
          configurable: true,
          get() { return descriptor.get.call(this) },
          set(value) { if (!String(value).includes('portada')) descriptor.set.call(this, value) },
        })
        HTMLVideoElement.prototype.requestVideoFrameCallback = () => 0
        HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {}
      }, stalled)
      await page.route('**/api/tour/event', route => route.fulfill({ json: { ok: true } }))
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 })
      await page.addStyleTag({ content: 'nextjs-portal { display:none !important }' })
      await page.locator('[data-showroom-menu]').waitFor()
      const cookies = page.getByRole('button', { name: 'Aceptar cookies', exact: true })
      if (await cookies.isVisible()) await cookies.click()
      const label = `${width}x${height} ${stalled ? 'stalled cover' : 'normal cover'}`
      await page.evaluate(() => { window.__homeAt = performance.now() })
      await waitForEnter(page, label + ' initial')
      if (stalled) assert.equal(await page.locator('video').evaluateAll(videos => videos.some(video => (video.currentSrc || video.src).includes('portada') && video.readyState >= 2)), false)
      // The cover is already open: planEntryOpen and shellMode do not change.
      for (let n = 1; n <= 3; n++) {
        await home(page)
        const elapsed = await waitForEnter(page, `${label} reopen ${n}`)
        if (stalled) assert.ok(elapsed >= 2400, 'stalled cover must use the rearmed fallback')
      }
      // A second reopen before the first timer expires must replace that timer.
      await home(page)
      await page.waitForTimeout(500)
      await home(page)
      const rapid = await waitForEnter(page, label + ' rapid reopen')
      if (stalled) assert.ok(rapid >= 2400, 'old timer must not mark a newer cover ready')
      // Return from a unit as well as from the already-open cover.
      await page.locator('[data-showroom-menu]').click()
      await page.getByRole('button', { name: 'Buscar departamentos', exact: true }).click()
      await page.getByRole('button', { name: 'Abrir ficha', exact: true }).first().click()
      await page.locator('.tour-ficha-sheet').waitFor()
      await home(page)
      await waitForEnter(page, label + ' from unit')
      await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
      await page.getByRole('button', { name: 'Ingresar', exact: true }).waitFor({ state: 'hidden' })
      console.log(`PASS ${label}: actual INGRESAR click starts entry`)
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
