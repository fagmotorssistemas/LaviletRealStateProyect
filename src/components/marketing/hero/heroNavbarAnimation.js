// Adapt the reference's three canvas labels to the existing navbar without moving it.
export function createHeroNavbar(root, geometry) {
  const header = document.querySelector('[data-site-header]')
  const desktop = window.matchMedia('(min-width: 1024px)')
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const comp = root.querySelector('[data-part="comp"]')
  const originals = new Map()
  let observer, mutation, update

  function items() {
    return header ? Array.from(header.querySelectorAll('[data-hero-nav-item]')).filter(el => el.getClientRects().length) : []
  }

  function release() {
    if (header) {
      delete header.dataset.heroVisible
      header.style.removeProperty('--hero-header-opacity')
    }
    originals.forEach((saved, el) => {
      el.style.removeProperty('--hero-nav-opacity')
      el.style.removeProperty('--hero-nav-y')
      el.inert = saved
    })
  }

  function render(T) {
    if (!header) return
    const active = desktop.matches && !motion.matches && root.getBoundingClientRect().bottom > 0
    header.dataset.heroVisible = String(active)
    if (!active) { release(); return }
    const t0 = Math.min(Math.max((T - 0.16) / 0.20, 0), 1)
    const first = 1 - (1 - t0) * (1 - t0)
    header.style.setProperty('--hero-header-opacity', first.toFixed(3))
    items().forEach((el, i) => {
      if (!originals.has(el)) originals.set(el, el.inert)
      const t = Math.min(Math.max((T - (0.16 + i * 0.05)) / 0.20, 0), 1)
      const k = 1 - (1 - t) * (1 - t)
      // Compensate the parent fade so each item's resulting opacity is exactly k.
      el.style.setProperty('--hero-nav-opacity', (first ? k / first : 0).toFixed(4))
      el.style.setProperty('--hero-nav-y', `${(-10 * (1 - k)).toFixed(1)}px`)
      el.inert = k === 0
    })
  }

  function setPath(path, d) {
    if (path.el.getAttribute('d') === d) return
    path.el.setAttribute('d', d)
    path.L = path.el.getTotalLength()
    path.el.style.strokeDasharray = path.L
  }

  function align(paths) {
    if (!header || !desktop.matches) {
      setPath(paths.pH, 'M93.5 79.5 H1672')
      setPath(paths.pV, 'M93.5 79.5 V893')
      paths.pU.el.style.visibility = 'hidden'
      return
    }
    const s = geometry().s
    const rect = comp.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    const headerY = new DOMMatrixReadOnly(getComputedStyle(header).transform).m42
    const y = (headerRect.bottom - headerY - rect.top) / s
    setPath(paths.pH, `M93.5 ${y.toFixed(3)} H${((headerRect.right - rect.left) / s).toFixed(3)}`)
    setPath(paths.pV, `M93.5 ${y.toFixed(3)} V893`)
    const links = Array.from(header.querySelectorAll('nav a')).filter(el => el.getClientRects().length)
    const link = links.find(el => el.getAttribute('href') === '/proyectos') || links[0]
    paths.pU.el.style.visibility = link ? 'visible' : 'hidden'
    if (link) {
      const r = link.getBoundingClientRect()
      const item = link.closest('[data-hero-nav-item]')
      const itemY = item ? new DOMMatrixReadOnly(getComputedStyle(item).transform).m42 : 0
      const underlineY = (r.bottom - headerY - itemY + 2.5 - rect.top) / s
      setPath(paths.pU, `M${((r.left - rect.left) / s).toFixed(3)} ${underlineY.toFixed(3)} H${((r.right - rect.left) / s).toFixed(3)}`)
    }
  }

  return {
    render, align,
    start(onChange) {
      update = onChange
      desktop.addEventListener('change', update)
      if (!header) return
      observer = new ResizeObserver(update)
      observer.observe(header)
      if (header.firstElementChild) observer.observe(header.firstElementChild)
      mutation = new MutationObserver(update)
      mutation.observe(header, { childList: true, subtree: true })
    },
    destroy() {
      if (update) desktop.removeEventListener('change', update)
      observer?.disconnect()
      mutation?.disconnect()
      release()
    },
  }
}
