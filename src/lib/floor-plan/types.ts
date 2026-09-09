export type Point = [number, number]

export type BoundingBox = {
  x: number
  y: number
  width: number
  height: number
}

export type OCRLabel = {
  text: string
  confidence: number
  bbox: [number, number, number, number]
}

export type Apartment = {
  id: string
  polygon: Point[]
  bbox: BoundingBox
  center: [number, number]
  area?: number
  confidence: number
  needsReview?: boolean
  labelConfidence?: number
}

export type CommonArea = {
  id: string
  type: string
  polygon: Point[]
  bbox: BoundingBox
  center: [number, number]
  confidence: number
}

export type AnalysisResult = {
  success: boolean
  image: { width: number; height: number }
  apartments: Apartment[]
  commonAreas: CommonArea[]
  labels: OCRLabel[]
  meta?: {
    pipeline?: string
    segmentationProvider?: string
    ocrAvailable?: boolean
  }
  error?: string
}

export type AnalyzePlanErrorCode =
  | 'invalid_image'
  | 'unsupported_format'
  | 'too_large'
  | 'processing_error'
  | 'timeout'
  | 'no_apartments'
  | 'service_unavailable'
  | 'unknown'
