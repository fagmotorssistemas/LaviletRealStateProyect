export function createTourArrow(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tour-nav-arrow'
  el.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 14.5L12 9.5l4.5 5" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  return el
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function roomHotspotHtml(label: string) {
  return `<div class="tour-hotspot"><span class="tour-hotspot-disc"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 9.5 12 14.5l4.5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="tour-hotspot-label">${escapeHtml(label)}</span></div>`
}
