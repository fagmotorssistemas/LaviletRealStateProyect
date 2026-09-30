import { NextResponse } from 'next/server'
import { listAmenityGallery } from '@/lib/tour/amenityImages'

export const runtime = 'nodejs'

/** Galería de amenidades: cada foto de public/tour/amenidades con el texto de su nombre. */
export async function GET() {
  const items = await listAmenityGallery()
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}
