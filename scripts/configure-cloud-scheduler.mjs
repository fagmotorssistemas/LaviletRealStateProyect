import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('@next/env').loadEnvConfig(process.cwd())
const expected = 'https://xhjnyntywqhczdtecgim.supabase.co'
const configured = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const secret = process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET

// El secreto va directamente del entorno al RPC autorizado; nunca se imprime ni se escribe a un archivo.
try {
  if (!configured || new URL(configured).origin !== expected) throw new Error('WRONG_SUPABASE_PROJECT')
  if (!serviceKey || !secret || secret.length < 32 || secret.length > 4096 || /[\r\n]/.test(secret)) {
    throw new Error('SCHEDULER_CREDENTIALS_MISSING_OR_INVALID')
  }
  const response = await fetch(`${expected}/rest/v1/rpc/lv_app_set_scheduler_secret`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: secret }),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`SCHEDULER_CONFIG_HTTP_${response.status}`)
  if (await response.json() !== true) throw new Error('SCHEDULER_CONFIG_INVALID_RESPONSE')
  console.log('Secreto del ejecutor guardado en Supabase Vault. El comando no activa el cron ni envia mensajes.')
} catch (error) {
  console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'SCHEDULER_CONFIG_FAILED')
  process.exitCode = 1
}
