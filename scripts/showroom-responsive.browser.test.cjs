// Responsive showroom chrome: menu visible, controls on screen, no overlap, no horizontal scroll.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const base = process.env.SHOWROOM_URL || 'http://localhost:3000/tour'
const viewports = [
  { width: 740, height: 360, touch: true },
  { width: 812, height: 375, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 932, height: 430, touch: true },
  { width: 375, height: 812, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 412, height: 915, touch: true },
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
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const centerInside = cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight
      let covered = false
      let underModal = false
      if (centerInside) {
        const hit = document.elementFromPoint(cx, cy)
        const hitsSelf = hit && (hit === el || el.contains(hit) || hit.contains(el))
        const modalTop = hit && (hit.closest('[role="dialog"]') || hit.closest('.tour-modal-sheet') || hit.classList.contains('inset-0'))
        const devPortal = hit && (hit.tagName === 'NEXTJS-PORTAL' || hit.closest('nextjs-portal'))
        underModal = !hitsSelf && Boolean(modalTop)
        covered = !hitsSelf && !modalTop && !devPortal
        if (covered && hit) {
          el.dataset.hitCover = `${hit.tagName}:${(hit.getAttribute('aria-label') || hit.getAttribute('class') || '').slice(0, 80)}`
        }
      }
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
        rail: Boolean(el.closest('.tour-floor-rail')),
        textLink: el.tagName === 'A' && r.height < 36 && r.width > r.height * 2,
        covered,
        underModal,
        hit: el.dataset.hitCover || '',
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
      fichaOpen:
        Boolean(document.querySelector('.tour-ficha-sheet')) &&
        !document.querySelector('.tour-modal-sheet input, .tour-modal-sheet textarea'),
      sheet: (() => {
        const el = document.querySelector('.tour-ficha-sheet')
        if (!el) return null
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return { top: s.top, bottom: s.bottom, height: Math.round(r.height), y: Math.round(r.y), overflow: s.overflow }
      })(),
      railFits: (() => {
        const rail = document.querySelector('.tour-floor-rail')
        if (!rail || window.innerHeight > 500) return true
        return rail.scrollHeight <= rail.clientHeight + 2
      })(),
      menu: menuBox ? { x: menuBox.left, y: menuBox.top, w: menuBox.width, h: menuBox.height, display: getComputedStyle(menu).display } : null,
      controls,
    }
  })
}

async function dismissRotateToast(page) {
  const close = page.getByRole('button', { name: 'Cerrar aviso' })
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined)
}

async function assertPlanPan(page, label) {
  const frame = page.locator('[data-plan-frame]')
  await frame.waitFor({ state: 'visible', timeout: 8000 })
  const stage = page.locator('[data-plan-stage]')
  const box = await stage.boundingBox()
  const max = Number(await frame.getAttribute('data-pan-max'))
  assert.ok(box && box.height >= page.viewportSize().height * 0.85, `${label}: el plano no ocupa el alto`)
  assert.ok(max > 20, `${label}: el plano no sobresale (max=${max})`)
  const drag = async (dx) => {
    const origin = await stage.boundingBox()
    const x = origin.x + origin.width / 2
    const y = origin.y + origin.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(250)
  }
  const step = Math.round(box.width * 0.45)
  let pan = 0
  for (let i = 0; i < 16 && (pan = Number(await frame.getAttribute('data-pan'))) < max - 4; i += 1) {
    await drag(step)
  }
  pan = Number(await frame.getAttribute('data-pan'))
  assert.ok(Math.abs(pan - max) < 4, `${label}: no llega al borde izquierdo pan=${pan} max=${max}`)
  for (let i = 0; i < 24 && (pan = Number(await frame.getAttribute('data-pan'))) > -max + 4; i += 1) {
    await drag(-step)
  }
  pan = Number(await frame.getAttribute('data-pan'))
  assert.ok(Math.abs(pan + max) < 4, `${label}: no llega al borde derecho pan=${pan} max=${max}`)
  for (let i = 0; i < 24 && Math.abs((pan = Number(await frame.getAttribute('data-pan')))) > 8; i += 1) {
    await drag(pan > 0 ? -step : step)
  }
  await page.getByText('Desliza para ver todo el edificio').waitFor({ state: 'hidden', timeout: 2000 })
}

async function openPlan(page) {
  const cookies = page.getByRole('button', { name: 'Aceptar cookies' })
  if (await cookies.count()) await cookies.click().catch(() => undefined)
  const size = page.viewportSize()
  if (size && size.height > size.width) {
    const toast = page.locator('[data-rotate-toast]')
    await toast.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined)
    if (await toast.isVisible().catch(() => false)) {
      const box = await toast.boundingBox()
      assert.ok(box && box.height < size.height * 0.45, 'el aviso de giro tapa la pantalla')
      const enter = page.getByRole('button', { name: 'Ingresar', exact: true })
      if (await enter.isVisible().catch(() => false)) {
        const open = await enter.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return Boolean(hit && (hit === el || el.contains(hit)))
        })
        assert.ok(open, 'el aviso tapa Ingresar')
      }
    }
    await dismissRotateToast(page)
  }
  await page.locator('[data-showroom-menu]').waitFor({ state: 'visible', timeout: 30000 })
  const enter = page.getByRole('button', { name: 'Ingresar', exact: true })
  if (await enter.count() && (await enter.isVisible())) {
    assert.equal(await page.getByRole('link', { name: 'Volver a la página web' }).count(), 0)
    await enter.click()
    const skip = page.getByRole('button', { name: 'Saltar', exact: true })
    const terraza = page.getByRole('button', { name: 'Terraza', exact: true })
    await Promise.race([
      skip.waitFor({ state: 'visible', timeout: 12000 }).catch(() => undefined),
      terraza.waitFor({ state: 'visible', timeout: 12000 }).catch(() => undefined),
    ])
    if (await skip.isVisible().catch(() => false)) {
      await page.waitForTimeout(400)
      if (await skip.isVisible().catch(() => false)) {
        const box = await skip.boundingBox().catch(() => null)
        assert.ok(
          !box || box.y > page.viewportSize().height * 0.45,
          `Saltar debe quedar en la mitad inferior (y=${box ? Math.round(box.y) : 'sin caja'})`,
        )
        await skip.click().catch(() => undefined)
      }
    }
    await page.getByRole('button', { name: 'Ingresar', exact: true }).waitFor({ state: 'hidden', timeout: 15000 })
  }
  await page.getByRole('button', { name: 'Terraza', exact: true }).waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(500)
}

function isPlanPin(name) {
  return name.startsWith('Departamento ') || name.startsWith('Zona ') || /^Imagen \d/.test(name)
}

function assertChrome(chrome, label) {
  const controls = chrome.controls.filter((item) => !isPlanPin(item.name) && !item.underModal)
  if (chrome.fichaOpen) {
    assert.ok(!chrome.menu, `${label}: el menú del showroom debe ocultarse con la ficha`)
  } else {
    assert.ok(chrome.menu && chrome.menu.display !== 'none', `${label}: menú oculto`)
    assert.ok(chrome.menu.w >= 40 && chrome.menu.h >= 40, `${label}: menú ${chrome.menu.w}x${chrome.menu.h}`)
    assert.ok(
      chrome.menu.x >= -1 &&
        chrome.menu.y >= -1 &&
        chrome.menu.x + chrome.menu.w <= chrome.vw + 1 &&
        chrome.menu.y + chrome.menu.h <= chrome.vh + 1,
      `${label}: menú fuera de pantalla`,
    )
  }
  assert.ok(chrome.scrollWidth <= chrome.clientWidth + 1, `${label}: scroll horizontal ${chrome.scrollWidth}>${chrome.clientWidth}`)
  const off = controls.filter(
    (item) =>
      !item.inScroll &&
      (item.x < -1 || item.y < -1 || item.x + item.w > chrome.vw + 1 || item.y + item.h > chrome.vh + 1),
  )
  assert.deepEqual(
    off.map((item) => `${item.name} x=${Math.round(item.x)} y=${Math.round(item.y)} ${Math.round(item.w)}x${Math.round(item.h)} vh=${chrome.vh} vw=${chrome.vw}`),
    [],
    `${label}: controles fuera de pantalla ${JSON.stringify(chrome.sheet)}`,
  )
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
  assert.deepEqual(
    controls
      .filter((item) => item.covered && !(item.w > chrome.vw * 0.9 && item.h > chrome.vh * 0.9))
      .map((item) => `${item.name} <- ${item.hit}`),
    [],
    `${label}: botones tapados`,
  )
  assert.ok(chrome.railFits, `${label}: la barra de pisos hace scroll`)
  if (chrome.coarse) {
    const small = controls.filter((item) => {
      if (item.textLink) return false
      const minH = item.rail && chrome.vh <= 500 ? 30 : 40
      return item.w < 40 || item.h < minH
    })
    assert.deepEqual(
      small.map((item) => `${item.name} ${Math.round(item.w)}x${Math.round(item.h)}`),
      [],
      `${label}: controles bajo 40px`,
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
        screen: viewport.touch ? { width: viewport.width, height: viewport.height } : undefined,
        hasTouch: viewport.touch,
        isMobile: viewport.touch,
        userAgent:
          viewport.touch && viewport.height > viewport.width
            ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            : undefined,
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await openPlan(page)
      const label = `${viewport.width}x${viewport.height}`
      assertChrome(await readChrome(page), `${label} plano`)
      if (viewport.height > viewport.width && viewport.touch) await assertPlanPan(page, label)
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
      if (viewport.height > viewport.width) {
        const pano = await page.locator('.psv-container, .tour-pano-stage').first().boundingBox()
        assert.ok(pano && pano.height >= viewport.height * 0.85, `${label}: el 360 no ocupa el alto`)
      }

      await clickNamed(page, 'Galería')
      await page.waitForTimeout(400)
      assertChrome(await readChrome(page), `${label} galería`)

      await clickNamed(page, 'Terminaciones')
      await page.waitForTimeout(300)
      assertChrome(await readChrome(page), `${label} terminaciones`)

      await openFicha(page)
      const fichaDialog = page.getByRole('dialog', { name: 'Ficha técnica' })
      await fichaDialog.waitFor({ state: 'visible', timeout: 8000 })
      assertChrome(await readChrome(page), `${label} ficha`)
      if (viewport.width === 740 && viewport.height === 360) {
        const box = await fichaDialog.boundingBox()
        assert.ok(box && box.y <= 2 && box.height >= viewport.height - 4, `${label}: la ficha no ocupa el alto`)
        await fichaDialog.locator('.tour-ficha-shorthead').waitFor({ state: 'visible' })
        assert.equal(await page.locator('[data-showroom-toolbar]').count(), 0)
        await fichaDialog.locator('.tour-ficha-shorthead').getByRole('button', { name: 'Cerrar', exact: true }).click()
        await fichaDialog.waitFor({ state: 'hidden', timeout: 5000 })
      }
      const info = page.getByRole('button', { name: /Solicitar información/ })
      if (await info.count()) {
        await info.first().click()
        await focusForm(page, `${label} información`)
        await closeDialog(page)
      }
      const ficha = page.getByRole('dialog', { name: 'Ficha técnica' })
      if (await ficha.isVisible().catch(() => false)) {
        const shortClose = ficha.locator('.tour-ficha-shorthead').getByRole('button', { name: 'Cerrar', exact: true })
        const close =
          (await shortClose.count()) && (await shortClose.isVisible())
            ? shortClose
            : ficha.locator('.tour-ficha-chrome-mobile, .tour-ficha-media').getByRole('button', { name: 'Cerrar', exact: true })
        await close.last().click({ force: true }).catch(() => undefined)
        await ficha.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
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

    const androidUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 412, height: 915 },
    ]) {
      const context = await browser.newContext({
        viewport,
        screen: viewport,
        hasTouch: true,
        isMobile: true,
        userAgent: androidUa,
      })
      const page = await context.newPage()
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 })
      const cookies = page.getByRole('button', { name: 'Aceptar cookies' })
      if (await cookies.count()) await cookies.click().catch(() => undefined)
      const notice = page.getByText('Te recomendamos poner el celular en horizontal para una mejor experiencia')
      await notice.waitFor({ state: 'visible', timeout: 15000 })
      const box = await page.locator('[data-rotate-toast]').boundingBox()
      assert.ok(box && box.height < viewport.height * 0.45 && box.width < viewport.width, `${viewport.width}x${viewport.height}: el aviso bloquea`)
      const canLock = await page.evaluate(
        () => typeof screen.orientation?.lock === 'function' && document.fullscreenEnabled,
      )
      const landscape = page.getByRole('button', { name: 'Ver en horizontal' })
      if (canLock) await landscape.waitFor({ state: 'visible', timeout: 5000 })
      else assert.equal(await landscape.count(), 0)
      await page.getByRole('button', { name: 'Cerrar aviso' }).click()
      await notice.waitFor({ state: 'hidden', timeout: 5000 })
      await context.close()
      console.log('PASS portrait', `${viewport.width}x${viewport.height}`)
    }

    const instagramUa = `${androidUa} Instagram 319.0.0.0.0`
    const instagram = await browser.newContext({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: instagramUa,
    })
    const instagramPage = await instagram.newPage()
    await instagramPage.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 })
    const instagramCookies = instagramPage.getByRole('button', { name: 'Aceptar cookies' })
    if (await instagramCookies.count()) await instagramCookies.click().catch(() => undefined)
    const instagramNotice = instagramPage.getByText('Te recomendamos poner el celular en horizontal para una mejor experiencia')
    await instagramNotice.waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await instagramPage.getByRole('button', { name: 'Ver en horizontal' }).count(), 0)
    assert.equal(await instagramPage.getByText('Abre esta página en Chrome para verla en horizontal').count(), 0)
    await instagramPage.getByRole('button', { name: 'Cerrar aviso' }).click()
    await instagramNotice.waitFor({ state: 'hidden', timeout: 5000 })
    await openPlan(instagramPage)
    await instagram.close()
    console.log('PASS instagram portrait')

    const missing = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false })
    const missingPage = await missing.newPage()
    let missingImages = 0
    await missingPage.route(/floor-[^?#]+\.(?:webp|jpe?g|png)(?:\?|#|$)/i, (route) => {
      missingImages += 1
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' })
    })
    await missingPage.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await openPlan(missingPage)
    const flat = missingPage.getByRole('button', { name: '2d', exact: true })
    if ((await flat.count()) && (await flat.isEnabled())) {
      await flat.click()
      await missingPage.waitForFunction(
        () => document.querySelector('[data-plan-front]')?.getAttribute('data-plan-front') === '7',
        null,
        { timeout: 6000 },
      )
      assert.ok(missingImages > 0, 'la imagen 2D del piso no llegó a responder 404')
    }
    await missingPage.getByRole('button', { name: 'Sexta planta alta', exact: true }).click()
    await missingPage.getByRole('button', { name: 'Quinta planta alta', exact: true }).click()
    await missingPage.waitForFunction(
      () => document.querySelector('[data-plan-front]')?.getAttribute('data-plan-front') === '5',
      null,
      { timeout: 6000 },
    )
    await missingPage.getByRole('button', { name: 'Ingresar', exact: true }).waitFor({ state: 'hidden', timeout: 1000 })
    await missing.close()
    console.log('PASS floor image 404')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
