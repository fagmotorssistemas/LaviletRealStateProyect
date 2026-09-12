import { normalized } from './sdr-rules'

/** A received image is evidence; its OCR label alone is not a request to resend a link. */
export function isUnitVisualRequest(current: string) {
  const m = normalized(current.replace(/\[(?:Imagen|Archivo PDF):[\s\S]*?\]/g, ''))
  if (/\b(?:proyecto|edificio|fachada|asesor|piscina|gimnasio)\b/.test(m)
    && !/\b(?:unidad|departamento|departemento|depto|dpto|apto|apartamento|suite|local)\b/.test(m)) return false
  return /\b(?:modelos?|recorridos?|animacion|animaciones|3d|html|fotos?|fotografias?|imagenes?|renders?|planos?|videos?)\b/.test(m)
    || (/\b(?:enlace|link|vista interactiva|referencia interactiva)\b/.test(m) && !/ubicacion|mapa|llegar|direccion/.test(m))
}

export function isUnitPhotoRequest(current: string) {
  return /\b(?:fotos?|fotografias?|imagenes?|renders?)\b/.test(normalized(current))
}
