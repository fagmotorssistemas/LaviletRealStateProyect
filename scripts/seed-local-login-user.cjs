/**
 * Crea usuario de prueba SOLO en Supabase local (.env.local → :54331).
 * No toca producción.
 *
 * Uso: node scripts/seed-local-login-user.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(file)) throw new Error('Falta .env.local')
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

async function main() {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL || ''
  const service = env.SUPABASE_SERVICE_ROLE_KEY || ''
  assert.ok(url.includes('127.0.0.1') || url.includes('localhost'), `Refusing: URL is not local (${url})`)
  assert.ok(service, 'Falta SUPABASE_SERVICE_ROLE_KEY en .env.local')

  const email = process.env.LOCAL_LOGIN_EMAIL || 'admin.local@lavilet.test'
  const password = process.env.LOCAL_LOGIN_PASSWORD || 'LocalTest123!'
  const headers = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'Content-Type': 'application/json',
  }

  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Admin Local', role: 'admin' },
      app_metadata: { role: 'admin' },
    }),
  })
  const created = await createRes.json()
  if (!createRes.ok && !/already|registered|exists/i.test(String(created.msg || created.message || ''))) {
    // retry list
    throw new Error(`create user failed: ${JSON.stringify(created)}`)
  }

  let userId = created.id
  if (!userId) {
    const listRes = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=50`, { headers })
    const listed = await listRes.json()
    const found = (listed.users || []).find((u) => u.email === email)
    assert.ok(found, 'user not found after create')
    userId = found.id
  }

  const upsertRes = await fetch(`${url}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      id: userId,
      email,
      full_name: 'Admin Local',
      role: 'admin',
      is_active: true,
    }),
  })
  const upsertBody = await upsertRes.text()
  assert.ok(upsertRes.ok, `profiles upsert failed: ${upsertRes.status} ${upsertBody}`)

  const loginRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  const loginJson = await loginRes.json()
  assert.equal(loginRes.status, 200, `login verify failed: ${JSON.stringify(loginJson)}`)

  console.log(
    JSON.stringify(
      {
        ok: true,
        supabase: url,
        email,
        password,
        note: 'Solo válido en Supabase local. No usar estas credenciales en lavilet/producción.',
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
