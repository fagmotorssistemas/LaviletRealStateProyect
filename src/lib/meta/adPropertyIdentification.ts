/** Property evidence is deliberately independent of names, images and lead interests. */
export type PropertyTarget = { unitId: string | null; externalLabel: string | null }
export type PropertyGroup = 'inventory' | 'external' | 'multiple' | 'unidentified'
export type AdPromotedUnitLink = PropertyTarget & {
  id: string
  adId: string
  unitLabel: string | null
  assignedAt: string
  assignedBy: string | null
}
export type AdPromotedUnitSummary = {
  adId: string
  kind: 'none' | 'single' | 'multi'
  label: string
  links: AdPromotedUnitLink[]
  unambiguousUnitId: string | null
  group: PropertyGroup
  evidence: 'saved' | 'ad_link' | 'none'
  evidenceUrls: string[]
}

export function summarizePropertyLinks(adId: string, links: AdPromotedUnitLink[], evidence: AdPromotedUnitSummary['evidence'] = 'saved', evidenceUrls: string[] = []): AdPromotedUnitSummary {
  const unique = [...new Map(links.map(l => [l.unitId ? `unit:${l.unitId}` : `external:${l.externalLabel?.trim().toLowerCase()}`, l])).values()]
  const kind = unique.length > 1 ? 'multi' : unique.length ? 'single' : 'none'
  return {
    adId, kind, links: unique,
    label: unique.map(l => l.unitLabel || l.externalLabel || 'Propiedad sin identificar').join(' + ') || 'Propiedad sin identificar',
    unambiguousUnitId: unique.length === 1 ? unique[0].unitId : null,
    group: kind === 'multi' ? 'multiple' : kind === 'none' ? 'unidentified' : unique[0].unitId ? 'inventory' : 'external',
    evidence: unique.length ? evidence : 'none', evidenceUrls,
  }
}

export function collectAdDestinationUrls(creative: unknown): string[] {
  if (!creative || typeof creative !== 'object') return []
  const c = creative as Record<string, unknown>
  const out = new Set<string>()
  const add = (v: unknown) => { if (typeof v === 'string' && v.trim()) out.add(v.trim()) }
  const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {}
  const story = obj(c.object_story_spec)
  const link = obj(story.link_data)
  add(c.object_url); add(c.link_url); add(link.link)
  for (const item of Array.isArray(link.child_attachments) ? link.child_attachments : []) add(obj(item).link)
  for (const data of [link, obj(story.video_data)]) add(obj(obj(data.call_to_action).value).link)
  const feed = obj(c.asset_feed_spec)
  for (const item of Array.isArray(feed.link_urls) ? feed.link_urls : []) add(obj(item).website_url)
  return [...out]
}

export function identifyPropertyFromUrls(adId: string, urls: string[], inventory: Array<{ id: string; unit_number: string | null; category: string | null }>): AdPromotedUnitSummary {
  const units = new Map(inventory.map(u => [u.id.toLowerCase(), u]))
  const links: AdPromotedUnitLink[] = []
  // Every destination must be supported: a mixed/unknown carousel is not one unit.
  for (const raw of urls) {
    let url: URL
    try { url = new URL(raw) } catch { return summarizePropertyLinks(adId, []) }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['lavilett.com', 'www.lavilett.com'].includes(url.hostname)) return summarizePropertyLinks(adId, [])
    const match = /^\/tour\/unidad\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(url.pathname)
    const unit = match && units.get(match[1].toLowerCase())
    if (!unit) return summarizePropertyLinks(adId, [])
    links.push({id: '', adId, unitId: unit.id, unitLabel: `${unit.category || 'Unidad'} ${unit.unit_number || unit.id}`, externalLabel: null, assignedAt: '', assignedBy: null})
  }
  return summarizePropertyLinks(adId, links, 'ad_link', urls.map(raw => { const u = new URL(raw); return `${u.origin}${u.pathname}` }))
}

export function normalizePropertyTargets(targets: PropertyTarget[]): PropertyTarget[] {
  if (!Array.isArray(targets) || targets.length > 20) throw new Error('invalid_property_targets')
  const seen = new Set<string>()
  return targets.map(target => {
    const unitId = typeof target?.unitId === 'string' ? target.unitId.trim().toLowerCase() : null
    const externalLabel = typeof target?.externalLabel === 'string' ? target.externalLabel.trim() : null
    if (Boolean(unitId) === Boolean(externalLabel)) throw new Error('choose_unit_or_external')
    if (unitId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(unitId)) throw new Error('invalid_unit_id')
    if (externalLabel && (externalLabel.length > 160 || /[\x00-\x1f]/.test(externalLabel))) throw new Error('invalid_external_name')
    const key = unitId || externalLabel!.toLowerCase()
    if (seen.has(key)) throw new Error('duplicate_property')
    seen.add(key)
    return {unitId, externalLabel}
  })
}
