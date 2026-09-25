import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { buildLaviletHomeListingCatalog } from '@/services/homeListingCatalog.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Feed CSV público para Meta Home Listings (consulta periódica HTTPS).
 * Solo inventario publicable La Vilet; sin clientes ni secretos.
 */
export async function GET(request: Request) {
  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'catalog_unavailable' }, { status: 503 })
  }

  try {
    const snapshot = await buildLaviletHomeListingCatalog(admin)
    const url = new URL(request.url)
    if (url.searchParams.get('meta') === '1') {
      return NextResponse.json(
        {
          ok: true,
          generatedAt: snapshot.generatedAt,
          projectId: snapshot.projectId,
          exported: snapshot.rows.length,
          excluded: snapshot.excluded,
          datasetCompatibilityNote: snapshot.datasetCompatibilityNote,
          sampleHomeListingIds: snapshot.rows.slice(0, 5).map((row) => row.home_listing_id),
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=300, s-maxage=300',
          },
        },
      )
    }

    return new NextResponse(snapshot.csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'inline; filename="lavilet_home_listings.csv"',
        'Cache-Control': 'public, max-age=900, s-maxage=900',
        'X-Home-Listing-Exported': String(snapshot.rows.length),
        'X-Home-Listing-Excluded': String(snapshot.excluded.length),
        'X-Home-Listing-Generated-At': snapshot.generatedAt,
      },
    })
  } catch (error) {
    console.error('GET /api/meta/home-listings/catalog.csv', error)
    return NextResponse.json({ ok: false, error: 'catalog_build_failed' }, { status: 503 })
  }
}
