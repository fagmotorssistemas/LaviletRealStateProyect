import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTypologyAssetPublicUrl } from '@/services/inmobiliaria.service'
import type { TypologyAsset, TypologyImport } from '@/types/inmobiliaria'

export const runtime = 'nodejs'

export async function GET() {
  const admin = createAdminClient()
  const [{ data: typologies, error: tErr }, { data: assets, error: aErr }, { data: units, error: uErr }] =
    await Promise.all([
      admin.from('typologies_import').select('code, category, name, created_at').order('code', { ascending: true }),
      admin
        .from('typology_assets')
        .select('id, typology_code, kind, file_name, storage_path, sort_order, created_at')
        .order('sort_order', { ascending: true }),
      admin
        .from('units_import')
        .select(
          'id, unit_code, typology_code, floor_label, floor_number, price, status, bedrooms, bathrooms_full, area_internal_m2',
        )
        .order('floor_number', { ascending: true, nullsFirst: false })
        .order('unit_code', { ascending: true }),
    ])

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  const assetsByCode = new Map<string, TypologyAsset[]>()
  for (const row of (assets ?? []) as TypologyAsset[]) {
    const list = assetsByCode.get(row.typology_code) ?? []
    list.push(row)
    assetsByCode.set(row.typology_code, list)
  }

  return NextResponse.json({
    typologies: ((typologies ?? []) as TypologyImport[]).map((row) => {
      const list = assetsByCode.get(row.code) ?? []
      const toPublic = (item: TypologyAsset) => ({
        id: item.id,
        file_name: item.file_name,
        url: getTypologyAssetPublicUrl(admin, item.storage_path),
      })
      return {
        code: row.code,
        name: row.name,
        category: row.category,
        renders: list.filter((item) => item.kind === 'render').map(toPublic),
        planos: list.filter((item) => item.kind === 'plano').map(toPublic),
      }
    }),
    units: units ?? [],
  })
}
