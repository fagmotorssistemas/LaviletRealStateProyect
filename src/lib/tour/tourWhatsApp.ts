import { SITE } from '@/lib/marketing/site'
import { translateTourText, type TourLocale } from './tourMessages'

/** Mensaje desde el plano de pisos (showroom embebido). */
export const FLOOR_PLAN_WHATSAPP_MESSAGE =
  'Hola, estuve viendo La Vilet desde el showroom virtual y me gustaría conversar con un asesor comercial.'

export function floorPlanWhatsAppMessage(locale: TourLocale) {
  return locale === 'en' ? 'Hello, I have been exploring La Vilet in the virtual showroom and would like to speak with an advisor.' : FLOOR_PLAN_WHATSAPP_MESSAGE
}

export function buildTourWhatsAppMessage(args: {
  typologyCode: string
  roomLabel: string
  viewMode: 'tour' | 'vistas' | 'galeria' | 'planos-2d' | 'planos-3d'
  unitNumber?: string
  locale?: TourLocale
}): string {
  const typology = args.typologyCode.trim() || 'esta tipología'
  const room = args.roomLabel.trim() || 'este ambiente'
  const unit = args.unitNumber?.trim()
  if (args.locale === 'en') {
    return `Hello, I am exploring the ${SITE.name} 360° showroom. ${unit ? `I am interested in unit ${unit} (${typology}).` : `I am interested in layout ${typology}${args.roomLabel ? ` and I am viewing ${translateTourText(room, 'en')}` : ''}.`} Could you send me more information or arrange a visit?`
  }

  if (unit) {
    return [
      `Hola, estoy en el showroom 360° de ${SITE.name}.`,
      `Me interesa la unidad ${unit} (${typology}).`,
      '¿Me pueden dar más información o agendar una visita?',
    ].join(' ')
  }

  if (args.viewMode === 'tour') {
    return [
      `Hola, estoy en el showroom 360° de ${SITE.name}.`,
      `Me interesa el departamento ${typology}.`,
      `Estoy viendo ${room.toLowerCase()} y me llamó la atención.`,
      '¿Me pueden dar más información?',
    ].join(' ')
  }

  if (args.viewMode === 'vistas' || args.viewMode === 'galeria') {
    const kind = args.viewMode === 'galeria' ? 'la galería' : 'una vista'
    return [
      `Hola, estoy en el showroom 360° de ${SITE.name}.`,
      `Me interesa el departamento ${typology}.`,
      `Estoy viendo ${kind} (${room}) y me llamó la atención.`,
      '¿Me pueden dar más información?',
    ].join(' ')
  }

  const planoKind = args.viewMode === 'planos-3d' ? 'planos 3D' : 'planos 2D'
  return [
    `Hola, estoy en el showroom 360° de ${SITE.name}.`,
    `Me interesa el departamento ${typology}.`,
    `Estoy viendo los ${planoKind}${room ? ` (${room})` : ''} y me llamó la atención.`,
    '¿Me pueden dar más información?',
  ].join(' ')
}

export function tourWhatsAppHref(message: string) {
  if (!SITE.whatsapp) return null
  return `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(message)}`
}
