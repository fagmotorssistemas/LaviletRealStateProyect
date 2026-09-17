/**
 * Restaura .env.local al Supabase habitual de Lavilet (desde .env seguro).
 * Guarda el perfil financing-local en .env.local.financing.
 * No imprime secretos.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const envPath = path.join(root, '.env')
const localPath = path.join(root, '.env.local')
const financingPath = path.join(root, '.env.local.financing')
const backupDir = path.join(root, 'backups')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')

function parse(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

function jwtRef(v) {
  try {
    const p = v.split('.')[1]
    const pad = '='.repeat((4 - (p.length % 4)) % 4)
    return JSON.parse(Buffer.from(p + pad, 'base64').toString()).ref || null
  } catch {
    return null
  }
}

const base = parse(envPath)
const local = parse(localPath)

if (!base.NEXT_PUBLIC_SUPABASE_URL || !base.NEXT_PUBLIC_SUPABASE_ANON_KEY || !base.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('FAIL: .env no tiene URL/anon/service_role completos')
  process.exit(1)
}

const url = base.NEXT_PUBLIC_SUPABASE_URL
const anonRef = jwtRef(base.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const svcRef = jwtRef(base.SUPABASE_SERVICE_ROLE_KEY)
if (!url.includes('xhjnyntywqhczdtecgim')) {
  console.error('FAIL: .env URL no apunta al proyecto Lavilet esperado')
  process.exit(1)
}
if (anonRef && anonRef !== 'xhjnyntywqhczdtecgim') {
  console.error('FAIL: anon key ref mismatch')
  process.exit(1)
}
if (svcRef && svcRef !== 'xhjnyntywqhczdtecgim') {
  console.error('FAIL: service_role key ref mismatch')
  process.exit(1)
}
if (jwtRef(base.NEXT_PUBLIC_SUPABASE_ANON_KEY) === null && !base.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith('eyJ')) {
  console.error('FAIL: anon key inválida')
  process.exit(1)
}

fs.mkdirSync(backupDir, { recursive: true })
if (fs.existsSync(localPath)) {
  const bak = path.join(backupDir, `env.local.before-restore-${stamp}.bak`)
  fs.copyFileSync(localPath, bak)
  console.log('backup_ok', path.basename(bak))
}

// Conservar perfil financing-local (activable solo por comando explícito)
if (local.NEXT_PUBLIC_SUPABASE_URL && /127\.0\.0\.1|localhost/.test(local.NEXT_PUBLIC_SUPABASE_URL)) {
  const financingBody = `# Perfil OPCIONAL: Supabase local financing (solo con npm run env:local-financing)
# No usar como arranque habitual.

NEXT_PUBLIC_SUPABASE_URL=${local.NEXT_PUBLIC_SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${local.NEXT_PUBLIC_SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${local.SUPABASE_SERVICE_ROLE_KEY}
NEXT_PUBLIC_COOKIE_BANNER_ENABLED=${local.NEXT_PUBLIC_COOKIE_BANNER_ENABLED || 'true'}
`
  fs.writeFileSync(financingPath, financingBody, 'utf8')
  console.log('financing_profile_saved .env.local.financing')
}

const restored = `# =============================================================================
# ENTORNO HABITUAL DE DESARROLLO (localhost → Supabase Lavilet REAL)
# Proyecto: xhjnyntywqhczdtecgim
# AVISO: estás conectado a datos reales. No ejecutes seeds/migraciones/escrituras de prueba.
# Stack financing local: npm run env:local-financing  (luego npm run env:remote para volver)
# =============================================================================

NEXT_PUBLIC_SUPABASE_URL=${base.NEXT_PUBLIC_SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${base.NEXT_PUBLIC_SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${base.SUPABASE_SERVICE_ROLE_KEY}

# Integraciones outbound deshabilitadas en localhost (no envía a Meta/CAPI)
META_CAPI_BACKEND_URL=
META_CAPI_INTERNAL_SECRET=
META_MODE=test
META_CAPI_DELIVERY_LANE=test
NEXT_PUBLIC_META_PIXEL_ID=
NEXT_PUBLIC_COOKIE_BANNER_ENABLED=false

# Kommo / WhatsApp automation: sin tokens locales → no envío
KOMMO_ACCESS_TOKEN=
KOMMO_WEBHOOK_SECRET=
KOMMO_BASE_URL=
`

fs.writeFileSync(localPath, restored, 'utf8')
console.log(
  JSON.stringify(
    {
      ok: true,
      effectiveUrl: base.NEXT_PUBLIC_SUPABASE_URL,
      anonRole: 'anon',
      anonRef: anonRef || 'ok',
      serviceRole: 'service_role',
      serviceRef: svcRef || 'ok',
      metaOutbound: 'disabled',
      kommoOutbound: 'disabled',
    },
    null,
    2,
  ),
)
