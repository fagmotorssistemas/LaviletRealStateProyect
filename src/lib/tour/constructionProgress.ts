/** Fotos y videos reales, fechados y aprobados de la obra. */
export type ConstructionMedia = { type: 'image' | 'video'; url: string; caption: string }
export type ConstructionUpdate = {
  id: string
  date: string
  title: string
  description: string
  media: ConstructionMedia[]
}
