#!/usr/bin/env node
/**
 * Redacta un webhook Kommo (JSON o form aplanado) para revisar CTWA sin PII.
 *
 * Uso:
 *   node scripts/ctwa-webhook-capture-redact.mjs path/al/webhook.raw.json
 *   node scripts/ctwa-webhook-capture-redact.mjs path/al/webhook.form.txt
 *
 * Salida: JSON en stdout con:
 * - has_ctwa_clid / has_referral / field_paths (sin valores de clid)
 * - clid_present_len (longitud, no el valor)
 * - claves estructurales message[add][...]
 * - textos/teléfonos/nombres redactados
 *
 * No envía a Meta ni escribe en DB.
 */
import fs from 'fs'
import path from 'path'

const inputPath = process.argv[2]
if (!inputPath) {
  console.error('Uso: node scripts/ctwa-webhook-capture-redact.mjs <archivo>')
  process.exit(1)
}

const raw = fs.readFileSync(path.resolve(inputPath), 'utf8')

/** @type {Record<string, string>} */
let flat = {}

function flatten(obj, prefix = '') {
  if (obj == null) return
  if (typeof obj !== 'object') {
    flat[prefix] = String(obj)
    return
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}[${i}]` : String(i)))
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}[${k}]` : k
    flatten(v, next)
  }
}

const trimmed = raw.trim()
if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
  flatten(JSON.parse(trimmed))
} else {
  // application/x-www-form-urlencoded o líneas key=value
  for (const part of trimmed.split(/[&\n]/)) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = decodeURIComponent(part.slice(0, i).replace(/\+/g, ' '))
    const v = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '))
    flat[k] = v
  }
}

const CTWA_KEY = /ctwa_clid|ctwaClid|referral|source_type|source_id|source_url/i
const PII_KEY =
  /phone|tel|email|name|text|message|body|avatar|first_name|last_name|contact/i

const fieldPaths = []
let hasCtwa = false
let hasReferral = false
let clidLen = 0
/** @type {Record<string, string>} */
const redacted = {}

for (const [key, value] of Object.entries(flat)) {
  const isCtwaish = CTWA_KEY.test(key)
  const isMsg = /message\[add\]/i.test(key)
  if (isCtwaish || isMsg) {
    if (/ctwa_clid|ctwaClid/i.test(key) && String(value || '').trim()) {
      hasCtwa = true
      clidLen = Math.max(clidLen, String(value).trim().length)
      fieldPaths.push(key)
      redacted[key] = `<redacted_clid len=${String(value).trim().length}>`
    } else if (/referral/i.test(key)) {
      hasReferral = true
      if (PII_KEY.test(key) && !/source_type|source_id/i.test(key)) {
        redacted[key] = `<redacted len=${String(value || '').length}>`
      } else if (/source_url/i.test(key)) {
        redacted[key] = value ? `<url_present len=${value.length}>` : ''
      } else {
        redacted[key] = String(value ?? '')
      }
    } else if (PII_KEY.test(key)) {
      redacted[key] = `<redacted len=${String(value || '').length}>`
    } else {
      redacted[key] = String(value ?? '').slice(0, 120)
    }
  }
}

const report = {
  source_file: path.basename(inputPath),
  message_add_keys: Object.keys(flat).filter((k) => /message\[add\]/i.test(k))
    .length,
  has_ctwa_clid: hasCtwa,
  has_referral: hasReferral,
  ctwa_field_paths: fieldPaths,
  clid_present_len: hasCtwa ? clidLen : 0,
  note:
    'Valores de clid/PII redactados. Conservar este JSON para verificar extracción + persistencia (field_path / captured_at) sin pegar clid en chat.',
  redacted_fields: redacted,
}

console.log(JSON.stringify(report, null, 2))
