export const LEAD_SOURCES = [
  'referido',
  'instagram',
  'facebook_ads',
  'google_ads',
  'portal_web',
  'waba',
  'showroom_360',
  'feria',
  'evento',
  'otro',
] as const

export type LeadSource = (typeof LEAD_SOURCES)[number]

export const LEAD_SOURCE: { [K in LeadSource]: K } = {
  referido: 'referido',
  instagram: 'instagram',
  facebook_ads: 'facebook_ads',
  google_ads: 'google_ads',
  portal_web: 'portal_web',
  waba: 'waba',
  showroom_360: 'showroom_360',
  feria: 'feria',
  evento: 'evento',
  otro: 'otro',
}

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  referido: 'Referido',
  instagram: 'Instagram',
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  portal_web: 'Portal web',
  waba: 'WhatsApp',
  showroom_360: 'Showroom 360',
  feria: 'Feria',
  evento: 'Evento',
  otro: 'Otro',
}

export const LEAD_SOURCE_OPTIONS = LEAD_SOURCES.map((value) => ({
  value,
  label: LEAD_SOURCE_LABELS[value],
}))

const SOURCE_SET = new Set<string>(LEAD_SOURCES)

const SOURCE_ALIASES: Record<string, LeadSource> = {
  referido: LEAD_SOURCE.referido,
  instagram: LEAD_SOURCE.instagram,
  ig: LEAD_SOURCE.instagram,
  facebook_ads: LEAD_SOURCE.facebook_ads,
  facebook: LEAD_SOURCE.facebook_ads,
  facebookads: LEAD_SOURCE.facebook_ads,
  fb: LEAD_SOURCE.facebook_ads,
  fb_ads: LEAD_SOURCE.facebook_ads,
  google_ads: LEAD_SOURCE.google_ads,
  google: LEAD_SOURCE.google_ads,
  googleads: LEAD_SOURCE.google_ads,
  adwords: LEAD_SOURCE.google_ads,
  portal_web: LEAD_SOURCE.portal_web,
  portalweb: LEAD_SOURCE.portal_web,
  website: LEAD_SOURCE.portal_web,
  waba: LEAD_SOURCE.waba,
  whatsapp: LEAD_SOURCE.waba,
  wa: LEAD_SOURCE.waba,
  showroom_360: LEAD_SOURCE.showroom_360,
  showroom: LEAD_SOURCE.showroom_360,
  web_360: LEAD_SOURCE.showroom_360,
  web360: LEAD_SOURCE.showroom_360,
  tour_360: LEAD_SOURCE.showroom_360,
  tour360: LEAD_SOURCE.showroom_360,
  feria: LEAD_SOURCE.feria,
  feria_inmobiliaria: LEAD_SOURCE.feria,
  evento: LEAD_SOURCE.evento,
  evento_corporativo: LEAD_SOURCE.evento,
  otro: LEAD_SOURCE.otro,
  other: LEAD_SOURCE.otro,
}

function sourceKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

export function isLeadSource(value: string): value is LeadSource {
  return SOURCE_SET.has(value)
}

export function normalizeSource(value: string): LeadSource {
  const key = sourceKey(value)
  if (!key) return LEAD_SOURCE.otro
  if (isLeadSource(key)) return key
  return SOURCE_ALIASES[key] ?? LEAD_SOURCE.otro
}
