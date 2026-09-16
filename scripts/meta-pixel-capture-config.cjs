/**
 * Captura controlada de signals/config (CDN Meta) para fulfill local.
 * Sin cookies ni credenciales del sitio.
 *
 * Uso:
 *   node scripts/meta-pixel-capture-config.cjs --dry-run
 *   node scripts/meta-pixel-capture-config.cjs --fetch
 *   node scripts/meta-pixel-capture-config.cjs --domain=www.lavilett.com --fetch
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '923439043758658'
const OUT_DIR = path.join(__dirname, 'fixtures', 'meta-pixel-config')
const VERSION = process.env.META_PIXEL_CONFIG_VERSION || '2.9.401'
const CHANNEL = process.env.META_PIXEL_CONFIG_CHANNEL || 'stable'

function parseDomainArg() {
  const raw = process.argv.find((a) => a.startsWith('--domain='))
  if (raw) return raw.slice('--domain='.length).trim() || '127.0.0.1'
  const idx = process.argv.indexOf('--domain')
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1].trim()
  return '127.0.0.1'
}

const DOMAIN = parseDomainArg()
const OUT_STEM = DOMAIN === '127.0.0.1' ? PIXEL_ID : `${PIXEL_ID}.${DOMAIN}`
const OUT_FILE = path.join(OUT_DIR, `${OUT_STEM}.js`)
const OUT_PROV = path.join(OUT_DIR, `${OUT_STEM}.provenance.json`)

const META = {
  host: 'connect.facebook.net',
  path: `/signals/config/${PIXEL_ID}?v=${VERSION}&r=${CHANNEL}&domain=${encodeURIComponent(DOMAIN)}`,
}

function describeTransmission() {
  return {
    method: 'GET',
    url: `https://${META.host}${META.path}`,
    transmits_to_meta: {
      pixel_id: PIXEL_ID,
      domain_query_param: DOMAIN,
      channel: CHANNEL,
      library_version_hint: VERSION,
      client_meta: 'User-Agent e IP pública del entorno que ejecute el GET (CDN Meta)',
    },
    does_not_send: [
      'cookies de lavilett.com',
      'credenciales del sitio',
      'eventos PageView/ViewContent/Lead',
      'PII de formularios',
      'payloads CAPI',
    ],
    purpose:
      'Obtener el cuerpo real de signals/config para fulfill local en el harness. No es un evento.',
    storage: OUT_FILE,
    provenance: OUT_PROV,
  }
}

function fetchConfig() {
  const url = `https://${META.host}${META.path}`
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            Accept: '*/*',
            'User-Agent': 'LaviletPixelHarnessCapture/1.0 (local lab; not production)',
          },
        },
        (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          })
        },
      )
      .on('error', reject)
  })
}

async function main() {
  const doFetch = process.argv.includes('--fetch')
  const info = describeTransmission()
  console.log(JSON.stringify({ mode: doFetch ? 'fetch' : 'dry-run', request: info }, null, 2))

  if (!doFetch) {
    console.log(
      '\nNo se realizó ninguna petición. Pasa --fetch solo si aceptas la transmisión anterior.',
    )
    return
  }

  const res = await fetchConfig()
  if (!res.status || res.status >= 400 || !res.body) {
    throw new Error(`capture failed status=${res.status} body_len=${res.body?.length || 0}`)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const metaSidecar = {
    captured_at: new Date().toISOString(),
    source_url: info.url,
    domain: DOMAIN,
    http_status: res.status,
    content_type: res.headers['content-type'] || null,
    content_length: res.body.length,
    note: 'Cuerpo capturado del CDN Meta para fulfill local. No inventado. Sin cookies/credenciales.',
  }
  fs.writeFileSync(OUT_FILE, res.body, 'utf8')
  fs.writeFileSync(OUT_PROV, JSON.stringify(metaSidecar, null, 2), 'utf8')
  console.log(
    JSON.stringify(
      { saved: OUT_FILE, provenance: metaSidecar, preview_head: res.body.slice(0, 120) },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error.message || error) }, null, 2))
  process.exitCode = 1
})
