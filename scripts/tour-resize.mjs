/**
 * Genera WebP 4096 y 2048 a partir de un original (p. ej. 8192 del arquitecto).
 *
 *   node scripts/tour-resize.mjs public/tours/demo/tipo_a_sala_nogal_dia.png
 *
 * Salida junto al original:
 *   {basename}_4096.webp
 *   {basename}_2048.webp
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const WIDTHS = [4096, 2048]
const WEBP_QUALITY = 78

function stripWidthSuffix(basename) {
  return basename.replace(/_(8192|4096|2048)$/, '')
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

async function resizeOne(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`No existe: ${inputPath}`)
  }

  const dir = path.dirname(inputPath)
  const basename = stripWidthSuffix(path.basename(inputPath, path.extname(inputPath)))
  const image = sharp(inputPath, { limitInputPixels: 8192 * 8192 })
  const meta = await image.metadata()

  if (!meta.width || !meta.height) {
    throw new Error(`Sin dimensiones: ${inputPath}`)
  }

  console.log(`original  ${path.basename(inputPath)}  ${meta.width}×${meta.height}  ${formatBytes(fs.statSync(inputPath).size)}`)

  const results = []
  for (const width of WIDTHS) {
    const height = Math.round(width * (meta.height / meta.width))
    const outPath = path.join(dir, `${basename}_${width}.webp`)
    const info = await sharp(inputPath, { limitInputPixels: 8192 * 8192 })
      .resize(width, height, { fit: 'fill' })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toFile(outPath)

    console.log(`  ${path.basename(outPath)}  ${info.width}×${info.height}  ${formatBytes(info.size)}`)
    results.push({ width, path: outPath, bytes: info.size })
  }
  return results
}

const inputs = process.argv.slice(2)
if (inputs.length === 0) {
  console.error('Uso: node scripts/tour-resize.mjs <original> [original...]')
  process.exit(1)
}

const all = []
for (const input of inputs) {
  all.push(await resizeOne(path.resolve(input)))
}
