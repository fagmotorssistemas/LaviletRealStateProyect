// A temporary redirect keeps the published template URL stable for the future HTML brochure.
export function GET() {
  return new Response(null, { status: 307, headers: { Location: '/materiales/brochure-la-vilet-v5.pdf', 'Cache-Control': 'no-store' } })
}
