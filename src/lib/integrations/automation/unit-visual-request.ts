import { normalized } from './sdr-rules'

/** A received image is evidence; its OCR label alone is not a request to resend a link. */
export function isUnitVisualRequest(current: string) {
  const m = normalized(current.replace(/\[(?:Imagen|Archivo PDF):[\s\S]*?\]/g, ''))
  return /\b(?:modelos?|recorridos?|animacion|animaciones|3d|360|html|fotos?|fotografias?|imagenes?|renders?|planos?|videos?)\b/.test(m)
    || /\b(?:referencia|vista|ficha) interactiva\b/.test(m)
    || (/\b(?:muestr[ae](?:me|nos)?|ver)\b/.test(m) && /\b(?:sala|comedor|cocina|dormitorio|habitacion|bano|balcon|terraza|estudio|lavanderia|despensa)\b/.test(m))
    || (/\b(?:enlace|link)\b/.test(m) && !/ubicacion|mapa|llegar|direccion/.test(m))
}

export function isUnitPhotoRequest(current: string) {
  return /\b(?:fotos?|fotografias?|imagenes?|renders?)\b/.test(normalized(current))
}

export function isOnlyUnitVisualRequest(current: string) {
  if (!isUnitVisualRequest(current)) return false
  const m = normalized(current)
  return !/\b(?:precio|valor|cuanto|cuesta|financ|credito|entrada|cuota|cita|visita|agendar|reservar|incluye|ofrece|entrega|construccion)\b/.test(m)
}
