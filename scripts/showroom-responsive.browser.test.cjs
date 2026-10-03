// Responsive showroom chrome: menu visible, controls on screen, no overlap, no horizontal scroll.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const base = process.env.SHOWROOM_URL || 'http://localhost:3000/tour'
const viewports = [
  { width: 740, height: 360, touch: true },
  { width: 812, height: 375, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 932, height: 430, touch: true },
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
      let inScroll = false
      for (let node = el.parentElement; node; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY
        if (overflow === 'auto' || overflow === 'scroll') {
          inScroll = true
          break
        }
      }
      controls.push({
        name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        inScroll,
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

function isPlanPin(name) {
  return name.startsWith('Departamento ') || name.startsWith('Zona ') || /^Imagen \d/.test(name)
}

function assertChrome(chrome, label) {
  const controls = chrome.controls.filter((item) => !isPlanPin(item.name))
  assert.ok(chrome.menu && chrome.menu.display !== 'none', `${label}: menú oculto`)
  assert.ok(chrome.menu.w >= 43 && chrome.menu.h >= 43, `${label}: menú ${chrome.menu.w}x${chrome.menu.h}`)
  assert.ok(
    chrome.menu.x >= -1 &&
      chrome.menu.y >= -1 &&
      chrome.menu.x + chrome.menu.w <= chrome.vw + 1 &&
      chrome.menu.y + chrome.menu.h <= chrome.vh + 1,
    `${label}: menú fuera de pantalla`,
  )
  assert.ok(chrome.scrollWidth <= chrome.clientWidth + 1, `${label}: scroll horizontal ${chrome.scrollWidth}>${chrome.clientWidth}`)
  const off = controls.filter(
    (item) =>
      !item.inScroll &&
      (item.x < -1 || item.y < -1 || item.x + item.w > chrome.vw + 1 || item.y + item.h > chrome.vh + 1),
  )
  assert.deepEqual(off.map((item) => item.name), [], `${label}: controles fuera de pantalla`)
  const piled = []
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i]
      const b = controls[j]
      if (a.w > chrome.vw * 0.9 && a.h > chrome.vh * 0.9) continue
      if (b.w > chrome.vw * 0.9 && b.h > chrome.vh * 0.9) continue
      if (overlaps(a, b) > 8) piled.push(`${a.name} × ${b.name}`)
    }
  }
  assert.deepEqual(piled, [], `${label}: controles encimados ${JSON.stringify(controls.filter((item) => piled.some((pair) => pair.includes(item.name))).map((item) => ({ name: item.name, x: Math.round(item.x), y: Math.round(item.y), w: Math.round(item.w), h: Math.round(item.h) })))}`)
  if (chrome.coarse) {
    const small = controls.filter((item) => item.w < 43 || item.h < 43)
    assert.deepEqual(
      small.map((item) => `${item.name} ${Math.round(item.w)}x${Math.round(item.h)}`),
      [],
      `${label}: controles bajo 44px`,
    )
  }
}

async function clickNamed(page, name) {
  const direct = page.getByRole('button', { name, exact: true })
  const opener = page.getByRole('button', { name: 'Abrir modos de vista' })
  const opened = (await direct.count()) && (await direct.first().isVisible())
  if (!opened && (await opener.count()) && (await opener.isVisible())) await opener.click()
  const target = page.getByRole('button', { name, exact: true }).first()
  if (await target.isDisabled()) {
    if ((await opener.count()) && (await opener.isVisible())) await opener.click()
    return
  }
  await target.click()
}

async function openFicha(page) {
  const desk = page.getByRole('button', { name: /Ficha técnica/ })
  if ((await desk.count()) && (await desk.first().isVisible())) {
    await desk.first().click()
    return
  }
  await page.getByRole('button', { name: 'Menú', exact: true }).click()
  await page.getByRole('button', { name: 'Ficha', exact: true }).click()
}

async function focusForm(page, label) {
  const field = page.locator('.tour-modal-sheet input, .tour-modal-sheet textarea').first()
  await field.waitFor({ state: 'visible', timeout: 8000 })
  await field.focus()
  await page.waitForTimeout(150)
  const box = await field.boundingBox()
  const vp = page.viewportSize()
  assert.ok(box && box.y >= -1 && box.y + box.height <= vp.height + 1, `${label}: el campo queda fuera ${box ? Math.round(box.y) + '+' + Math.round(box.height) + ' vh=' + vp.height : 'sin caja'}`)
  assertChrome(await readChrome(page), label)
}

async function closeDialog(page) {
  const formClose = page.getByRole('button', { name: 'Cerrar formulario' })
  if ((await formClose.count()) && (await formClose.first().isVisible())) {
    await formClose.first().click({ force: true })
    return
  }
  const sheetClose = page.locator('.tour-modal-sheet').getByRole('button', { name: 'Cerrar', exact: true })
  if (await sheetClose.count()) await sheetClose.last().click()
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
      const label = `${viewport.width}x${viewport.height}`
      assertChrome(await readChrome(page), `${label} plano`)
      assert.equal(await page.getByRole('button', { name: 'Terraza', exact: true }).innerText(), 'T')
      for (const floor of ['Sexta planta alta', 'Quinta planta alta', 'Planta baja']) {
        await page.getByRole('button', { name: floor, exact: true }).click()
        await page.waitForTimeout(300)
      }
      assertChrome(await readChrome(page), `${label} pisos`)

      await page.locator('[data-showroom-menu]').click()
      await page.getByRole('button', { name: 'Departamento modelo / 360°' }).click()
      await page.getByRole('button', { name: '360°' }).first().click()
      await page.getByRole('button', { name: /Con el dedo/ }).waitFor({ state: 'visible', timeout: 15000 })
      assertChrome(await readChrome(page), `${label} navegación`)
      await page.getByRole('button', { name: /Con el dedo/ }).click({ force: true })
      await page.getByRole('button', { name: 'Abrir modos de vista' }).or(page.getByRole('button', { name: 'Galería', exact: true })).first().waitFor({ state: 'visible', timeout: 15000 })
      assertChrome(await readChrome(page), `${label} tour`)

      await clickNamed(page, 'Galería')
      await page.waitForTimeout(400)
      assertChrome(await readChrome(page), `${label} galería`)

      await clickNamed(page, 'Terminaciones')
      await page.waitForTimeout(300)
      assertChrome(await readChrome(page), `${label} terminaciones`)

      await openFicha(page)
      await page.getByRole('dialog', { name: 'Ficha técnica' }).waitFor({ state: 'visible', timeout: 8000 })
      assertChrome(await readChrome(page), `${label} ficha`)
      const info = page.getByRole('button', { name: /Solicitar información/ })
      if (await info.count()) {
        await info.first().click()
        await focusForm(page, `${label} información`)
        await closeDialog(page)
      }
      const ficha = page.getByRole('dialog', { name: 'Ficha técnica' })
      if (await ficha.isVisible().catch(() => false)) {
        const close = ficha.getByRole('button', { name: 'Cerrar', exact: true })
        if (await close.count()) await close.first().click({ force: true, timeout: 5000 }).catch(() => undefined)
      }

      await page.locator('[data-showroom-menu]').click()
      await page.getByRole('dialog', { name: 'Menú La Vilet' }).waitFor({ state: 'visible', timeout: 8000 })
      assertChrome(await readChrome(page), `${label} menú`)
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: 'Menú La Vilet' }).waitFor({ state: 'hidden', timeout: 8000 })

      await page.getByRole('button', { name: 'Guardar favorito' }).click()
      await focusForm(page, `${label} guardar`)
      await closeDialog(page)

      const sim = page.getByRole('button', { name: 'Simular', exact: true })
      const simDesk = page.getByRole('button', { name: /Simular inversión/ })
      if ((await simDesk.count()) && (await simDesk.first().isVisible())) await simDesk.first().click()
      else {
        await page.getByRole('button', { name: 'Menú', exact: true }).click()
        await sim.click()
      }
      const phoneField = page.locator('.tour-modal-sheet input, .tour-modal-sheet textarea').first()
      const simulator = page.getByRole('dialog', { name: 'Simulador de inversión' })
      await phoneField.or(simulator).first().waitFor({ state: 'visible', timeout: 8000 })
      if (await phoneField.isVisible()) {
        await focusForm(page, `${label} celular`)
        await closeDialog(page)
      } else {
        assertChrome(await readChrome(page), `${label} simulador`)
        await simulator.getByRole('button', { name: 'Cerrar', exact: true }).click({ force: true })
      }

      assert.deepEqual(errors.filter((message) => !/Failed to fetch|Load failed|NetworkError/i.test(message)), [])
      await context.close()
      console.log('PASS', label)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
