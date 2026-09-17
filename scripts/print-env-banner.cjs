/**
 * Aviso de entorno al arrancar `npm run dev` (sin secretos).
 */
const fs = require('fs')
const path = require('path')

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

const env = {
  ...parse(path.join(__dirname, '..', '.env')),
  ...parse(path.join(__dirname, '..', '.env.local')),
}
const url = String(env.NEXT_PUBLIC_SUPABASE_URL || '')

if (/xhjnyntywqhczdtecgim\.supabase\.co/.test(url)) {
  console.warn(
    '\n[lavilet-env] localhost → Supabase REAL (xhjnyntywqhczdtecgim). Datos de producción.\n' +
      'Meta/CAPI/Kommo outbound deshabilitados en .env.local. No ejecutes seeds/migraciones de prueba.\n',
  )
} else if (/127\.0\.0\.1|localhost/.test(url)) {
  console.warn(
    '\n[lavilet-env] localhost → Supabase LOCAL (financing). Para volver al habitual: npm run env:remote\n',
  )
} else if (!url) {
  console.error('\n[lavilet-env] Falta NEXT_PUBLIC_SUPABASE_URL en .env.local / .env\n')
} else {
  console.warn('\n[lavilet-env] NEXT_PUBLIC_SUPABASE_URL =', url, '\n')
}
