/**
 * Captura controlada de signals/config para servirla en local en el harness.
 * Por defecto solo imprime qué se pediría (--dry-run).
 * No publica ni activa Pixel real.
 *
 * Uso:
 *   node scripts/meta-pixel-capture-config.cjs --dry-run
 *   node scripts/meta-pixel-capture-config.cjs --fetch
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '923439043758658'
const OUT_DIR = path.join(__dirname, 'fixtures', 'meta-pixel-config')
const OUT_FILE = path.join(OUT_DIR, `${PIXEL_ID}.js`)
const META = {
  // Misma familia de URL observada en el harness previo (domain de laboratorio).
  host: 'connect.facebook.net',
  path: `/signals/config/${PIXEL_ID}?v=2.9.401&r=stable&domain=127.0.0.1`,
}

function describeTransmission() {
  return {
    method: 'GET',
    url: `https://${META.host}${META.path}`,
    transmits_to_meta: {
      pixel_id: PIXEL_ID,
      domain_query_param: '127.0.0.1',
      channel: 'stable',
      library_version_hint: '2.9.401',
      client_meta: 'User-Agent e IP pública del entorno que ejecute el GET (CDN Meta)',
    },
    does_not_send: [
      'cookies de lavilett.com',
      'eventos PageView/ViewContent',
      'PII de formularios',
      'payloads CAPI',
    ],
    purpose:
      'Obtener el cuerpo real de signals/config para fulfill local en el harness. No es un evento.',
    storage: OUT_FILE,
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
  const fetch = process.argv.includes('--fetch')
  const info = describeTransmission()
  console.log(JSON.stringify({ mode: fetch ? 'fetch' : 'dry-run', request: info }, null, 2))

  if (!fetch) {
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
    http_status: res.status,
    content_type: res.headers['content-type'] || null,
    content_length: res.body.length,
    note: 'Cuerpo capturado del CDN Meta para fulfill local. No inventado.',
  }
  fs.writeFileSync(OUT_FILE, res.body, 'utf8')
  fs.writeFileSync(
    path.join(OUT_DIR, `${PIXEL_ID}.provenance.json`),
    JSON.stringify(metaSidecar, null, 2),
    'utf8',
  )
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
