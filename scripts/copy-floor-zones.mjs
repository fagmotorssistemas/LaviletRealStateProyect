import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in env)) env[k] = v
  }
}
const key =
  String(env.SUPABASE_SERVICE_ROLE_KEY || '').match(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  )?.[0] || env.SUPABASE_SERVICE_ROLE_KEY
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const BUCKET = 'typology-assets'
const SCOPE = 'edificio'
const PUBLIC =
  `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}`

function zonesPath(floor) {
  return `${SCOPE}/floor-${floor}-zones.json`
}

function remapCode(code, fromFloor, toFloor) {
  const t = String(code || '').trim()
  if (/^\d{3}$/.test(t) && Number(t[0]) === fromFloor) return `${toFloor}${t.slice(1)}`
  return null
}

async function downloadJson(path) {
  const { data, error } = await sb.storage.from(BUCKET).download(path)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text())
  } catch {
    return null
  }
}

async function uploadJson(path, doc) {
  const payload = Buffer.from(JSON.stringify(doc), 'utf8')
  const { error } = await sb.storage.from(BUCKET).upload(path, payload, {
    upsert: true,
    contentType: 'image/webp',
    cacheControl: '0',
  })
  if (error) throw new Error(`${path}: ${error.message}`)
}

function mediaFromUrl(url, width, height) {
  return {
    imageUrl: url || null,
    imageWidth: width || 1,
    imageHeight: height || 1,
  }
}

function buildTargetDoc(source, targetExisting, fromFloor, toFloor) {
  const zones = (source.zones || []).map((z, index) => {
    const id = remapCode(z.id, fromFloor, toFloor) || z.id
    const label = remapCode(z.label, fromFloor, toFloor) || id
    return {
      id,
      label,
      order: index,
      polygon: z.polygon,
      pointsPercent: z.pointsPercent,
      curvesPercent: z.curvesPercent,
      kind: z.kind || 'polygon',
    }
  })

  const planUrl = `${PUBLIC}/${SCOPE}/floor-${toFloor}-plan.webp`
  const existing2d = targetExisting?.variants?.['2d']?.imageUrl || targetExisting?.imageUrl
  const existing3d = targetExisting?.variants?.['3d']?.imageUrl || null
  const width =
    targetExisting?.variants?.['2d']?.imageWidth ||
    targetExisting?.imageWidth ||
    source.imageWidth ||
    1
  const height =
    targetExisting?.variants?.['2d']?.imageHeight ||
    targetExisting?.imageHeight ||
    source.imageHeight ||
    1

  const media2d = mediaFromUrl(existing2d || planUrl, width, height)
  const media3d = mediaFromUrl(existing3d, width, height)
  const preferred = media2d.imageUrl ? media2d : media3d

  return {
    floor: toFloor,
    typologyCode: SCOPE,
    imageUrl: preferred.imageUrl,
    imageWidth: preferred.imageWidth,
    imageHeight: preferred.imageHeight,
    variants: {
      '2d': media2d,
      '3d': media3d,
    },
    align: targetExisting?.align ||
      source.align || {
        '2d': { offsetX: 0, offsetY: 0, scale: 1 },
        '3d': { offsetX: 0, offsetY: 0, scale: 1 },
      },
    zones,
    updatedAt: new Date().toISOString(),
  }
}

const fromFloor = 3
const targets = [4, 5]
const source = await downloadJson(zonesPath(fromFloor))
if (!source?.zones?.length) {
  console.error('Floor 3 has no zones')
  process.exit(1)
}

console.log('Source floor 3 zones:', source.zones.map((z) => z.id).join(', '))

for (const toFloor of targets) {
  const path = zonesPath(toFloor)
  const existing = await downloadJson(path)
  console.log(
    `\nBefore floor ${toFloor}: zones=${existing?.zones?.length ?? 0}, image=${existing?.imageUrl || existing?.variants?.['2d']?.imageUrl || 'none'}`,
  )

  const doc = buildTargetDoc(source, existing, fromFloor, toFloor)
  await uploadJson(path, doc)

  const verify = await downloadJson(path)
  console.log(
    `After floor ${toFloor}: zones=${verify?.zones?.length ?? 0} → ${(verify?.zones || []).map((z) => z.id).join(', ')}`,
  )
  console.log(`  image=${verify?.imageUrl}`)
  console.log(`  2d=${verify?.variants?.['2d']?.imageUrl}`)
}

console.log('\nOK')
