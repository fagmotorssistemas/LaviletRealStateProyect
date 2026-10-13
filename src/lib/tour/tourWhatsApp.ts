import { SITE } from '@/lib/marketing/site'
import { commonAreaByCode, commonAreaLabel } from './commonAreas'
import { translateTourText, type TourLocale } from './tourMessages'

export type TourWhatsAppContext =
  | 'plano' | 'unidad' | 'zona_comun' | 'amenidades' | 'obra' | 'ubicacion'
  | 'comparador' | 'terminaciones' | 'simulador'

type UnitDescription = {
  unitNumber?: string | null
  category?: string | null
  bedrooms?: number | null
}

export type TourWhatsAppMessageArgs = UnitDescription & {
  context: TourWhatsAppContext
  locale?: TourLocale
  viewMode?: 'tour' | 'vistas' | 'galeria' | 'planos-2d' | 'planos-3d'
  roomLabel?: string | null
  floorLabel?: string | null
  commonAreaCode?: string | null
  amenityLabel?: string | null
  compareUnit?: UnitDescription | null
}

export function describeTourUnit(unit: UnitDescription, locale: TourLocale = 'es'): string {
  const category = (unit.category ?? '').trim().toLowerCase()
  const number = unit.unitNumber?.trim()
  const bedrooms = unit.bedrooms && unit.bedrooms > 0 ? unit.bedrooms : null
  if (locale === 'en') {
    const kind = category === 'suite' ? 'suite' : category === 'penthouse' ? 'penthouse' : category === 'local' ? 'commercial unit' : 'apartment'
    return `the ${kind}${number ? ` ${number}` : ''}${bedrooms && kind !== 'suite' ? ` with ${bedrooms} bedroom${bedrooms === 1 ? '' : 's'}` : ''}`
  }
  const kind = category === 'suite' ? 'la suite' : category === 'penthouse' ? 'el penthouse' : category === 'local' ? 'el local' : category === 'departamento' ? 'el departamento' : 'la unidad'
  return `${kind}${number ? ` ${number}` : ''}${bedrooms && kind !== 'la suite' ? ` de ${bedrooms} dormitorio${bedrooms === 1 ? '' : 's'}` : ''}`
}

function roomPhrase(label: string | null | undefined, locale: TourLocale) {
  const room = (label ?? '').trim() || (locale === 'en' ? 'room' : 'ambiente')
  if (locale === 'en') return `the ${translateTourText(room, 'en').toLowerCase()}`
  const lower = room.toLocaleLowerCase('es')
  if (/^(la|el|las|los)\s/.test(lower)) return lower
  return `${/^(sala|cocina|terraza|habitación|recámara|galería|vista|piscina)/.test(lower) ? 'la' : 'el'} ${lower}`
}

function englishFloor(label: string) {
  const levels: Record<string, string> = {
    Primera: 'first', Segunda: 'second', Tercera: 'third', Cuarta: 'fourth',
    Quinta: 'fifth', Sexta: 'sixth',
  }
  const match = /^(Primera|Segunda|Tercera|Cuarta|Quinta|Sexta) planta alta$/.exec(label)
  return match ? `${levels[match[1]]} floor` : translateTourText(label, 'en').toLowerCase()
}

export function floorPlanWhatsAppMessage(locale: TourLocale, floorLabel?: string) {
  return buildTourWhatsAppMessage({ context: 'plano', locale, floorLabel })
}

export function buildTourWhatsAppMessage(args: TourWhatsAppMessageArgs): string {
  const locale = args.locale ?? 'es'
  const unit = describeTourUnit(args, locale)
  const other = args.compareUnit ? describeTourUnit(args.compareUnit, locale) : locale === 'en' ? 'another unit' : 'otra unidad'
  const area = commonAreaByCode(args.commonAreaCode)
  const areaName = area ? commonAreaLabel(area, locale) : locale === 'en' ? 'common area' : 'área común'
  const amenity = args.amenityLabel?.trim() || (locale === 'en' ? 'Amenities' : 'Amenidades')
  const floor = args.floorLabel?.trim() || (locale === 'en' ? 'building plan' : 'plano del edificio')

  if (locale === 'en') {
    switch (args.context) {
      case 'plano': return `Hello, I am viewing the ${englishFloor(floor)} of La Vilet in the virtual showroom and would like to speak with an advisor.`
      case 'zona_comun': return `Hello, I am viewing ${areaName} at La Vilet in the virtual showroom. I would like to know more about the building's common areas.`
      case 'amenidades': return `Hello, I am viewing La Vilet's amenities (${amenity}) in the virtual showroom. Could you tell me more?`
      case 'obra': return `Hello, I saw La Vilet's construction progress in the virtual showroom. Could you tell me more?`
      case 'ubicacion': return 'Hello, I am viewing La Vilet’s location in the virtual showroom. Could you help me schedule a visit?'
      case 'comparador': return `Hello, I am comparing ${unit} and ${other} in the La Vilet showroom. Could you help me decide?`
      case 'terminaciones': return `Hello, I am viewing the finishes for ${unit} in the La Vilet showroom. Could you give me more information?`
      case 'simulador': return `Hello, I ran an investment simulation for ${unit} in the La Vilet showroom. Could you advise me?`
      case 'unidad': return args.viewMode === 'tour'
        ? `Hello, I am in the La Vilet showroom. I am interested in ${unit}. I am exploring ${roomPhrase(args.roomLabel, locale)} in 360°. Could you give me more information or arrange a visit?`
        : `Hello, I am in the La Vilet showroom. I am interested in ${unit}. I am viewing a photo of ${roomPhrase(args.roomLabel, locale)}. Could you give me more information or arrange a visit?`
    }
  }

  switch (args.context) {
    case 'plano': return `Hola, estoy viendo ${/^(plano|subsuelo)/i.test(floor) ? 'el' : 'la'} ${floor.toLocaleLowerCase('es')} de La Vilet en el showroom virtual y me gustaría hablar con un asesor.`
    case 'zona_comun': return `Hola, estoy viendo ${/^(spa|gym|lobby)/i.test(areaName) ? 'el' : 'la'} ${areaName.toLocaleLowerCase('es')} de La Vilet en el showroom virtual. Me gustaría saber más de las áreas comunes del edificio.`
    case 'amenidades': return `Hola, estoy viendo las amenidades de La Vilet (${amenity}) en el showroom virtual. ¿Me pueden contar más?`
    case 'obra': return `Hola, vi el avance de obra de La Vilet en el showroom virtual. ¿Me pueden contar más?`
    case 'ubicacion': return 'Hola, estoy viendo la ubicación de La Vilet en el showroom virtual. ¿Me ayudan a agendar una visita?'
    case 'comparador': return `Hola, estoy comparando ${unit} y ${other} en el showroom de La Vilet. ¿Me ayudan a decidir?`
    case 'terminaciones': return `Hola, estoy viendo los acabados de ${unit} en el showroom de La Vilet. ¿Me pueden dar más información?`
    case 'simulador': return `Hola, hice una simulación de inversión de ${unit} en el showroom de La Vilet. ¿Me pueden asesorar?`
    case 'unidad': return args.viewMode === 'tour'
      ? `Hola, estoy en el showroom de La Vilet. Me interesa ${unit}. Estoy recorriendo ${roomPhrase(args.roomLabel, locale)} en 360°. ¿Me pueden dar más información o agendar una visita?`
      : `Hola, estoy en el showroom de La Vilet. Me interesa ${unit}. Estoy viendo la foto de ${roomPhrase(args.roomLabel, locale)}. ¿Me pueden dar más información o agendar una visita?`
  }
}

export function tourWhatsAppHref(message: string) {
  if (!SITE.whatsapp) return null
  return `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(message)}`
}
