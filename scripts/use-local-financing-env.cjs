/**
 * Activa el perfil .env.local.financing (Supabase local :54331).
 * Uso explícito: npm run env:local-financing
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const financing = path.join(root, '.env.local.financing')
const localPath = path.join(root, '.env.local')
const backupDir = path.join(root, 'backups')

if (!fs.existsSync(financing)) {
  console.error('Falta .env.local.financing — genera con npm run env:remote primero o restaura el respaldo.')
  process.exit(1)
}

fs.mkdirSync(backupDir, { recursive: true })
if (fs.existsSync(localPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.copyFileSync(localPath, path.join(backupDir, `env.local.before-financing-${stamp}.bak`))
}
fs.copyFileSync(financing, localPath)
console.log('OK: .env.local → perfil financing local (127.0.0.1). Reinicia Next.')
console.log('Para volver al Supabase Lavilet habitual: npm run env:remote')
