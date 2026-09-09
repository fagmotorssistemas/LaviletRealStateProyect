import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
require('@next/env').loadEnvConfig(process.cwd())
const origin = new URL(process.env.AUTOMATION_APP_URL || 'http://localhost:3000')
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('AUTOMATION_APP_URL debe usar HTTPS')
if (origin.username || origin.password) throw new Error('No incluir credenciales en AUTOMATION_APP_URL')
const secret = process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET
if (!secret || secret.length < 32) throw new Error('Falta AUTOMATION_CRON_SECRET')
const watch = process.argv.includes('--watch')
do {
  const started = Date.now()
  try {
    const response = await fetch(new URL('/api/integrations/automation/run', origin), {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(240_000),
    })
    if (!response.ok) throw new Error(`HTTP_${response.status}`)
    const result = await response.json()
    console.log(JSON.stringify({ at: new Date().toISOString(), mode: result.mode, processed: result.processed ?? 0 }))
  } catch {
    console.error('No se completó la ejecución. Revisar estado de integración y eventos inciertos.')
    if (!watch) process.exitCode = 1
  }
  if (watch) await delay(Math.max(1000, 60_000 - (Date.now() - started)))
} while (watch)
