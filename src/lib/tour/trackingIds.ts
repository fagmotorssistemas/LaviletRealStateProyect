export const TOUR_TENANT_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
export const TOUR_PROJECT_ID = 'b1b2c3d4-0001-4000-8000-000000000001'

export const LV_VID_COOKIE = 'lv_vid'
/** Consentimiento publicitario: full | minimal | denied */
export const LV_ADS_CONSENT_COOKIE = 'lv_ads_consent'
/** Consentimiento de contacto / privacidad del tour (no implica ads). */
export const LV_CONTACT_CONSENT_COOKIE = 'lv_contact_consent'
/** Legacy — puede contener "1" (contacto) o full/minimal. No asumir ads. */
export const LV_CONSENT_COOKIE = 'lv_consent'
export const LV_VID_MAX_AGE = 400 * 24 * 60 * 60

export const TOUR_EVENT_TYPES = [
  'entrada',
  'salida',
  'ambiente',
  'cambio_acabado',
  'cambio_luz',
  'hotspot',
  'minimapa',
  'fullscreen',
  'vr',
  'gate_mostrado',
  'gate_cerrado',
  'lead_identificado',
  'whatsapp_interest',
  'guardar_unidad',
  'consultar_unidad',
] as const

export type TourEventType = (typeof TOUR_EVENT_TYPES)[number]

export function isTourEventType(value: string): value is TourEventType {
  return TOUR_EVENT_TYPES.includes(value as TourEventType)
}
