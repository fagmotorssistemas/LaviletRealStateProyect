/**
 * Segmentación por medianeras reales del plano:
 * 1) Detecta pasillo (barrera N/S)
 * 2) Detecta columnas de muro que atraviesan la franja (medianeras)
 * 3) Elige exactamente N deptos por fila (snap a picos fuertes)
 * 4) En cada celda: todos los píxeles no-muro → contorno exacto
 *
 *   npm run tour:segment-floor
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const INPUT = path.join(ROOT, 'public', 'plano-piso.jpg')
const MASK_OUT = path.join(ROOT, 'public', 'plano-piso-mask.png')
const OVERLAY_OUT = path.join(ROOT, 'public', 'plano-piso-overlay.png')
const TS_OUT = path.join(ROOT, 'src', 'lib', 'tour', 'floorPlanSlots.generated.ts')

const UNITS_PER_ROW = 5

function pix(data, x, y, w) {
  const i = (y * w + x) * 4
  return [data[i], data[i + 1], data[i + 2]]
}

function isWall(r, g, b) {
  const min = Math.min(r, g, b)
  const max = Math.max(r, g, b)
  const chroma = max - min
  if (min >= 220 && chroma <= 40) return true
  if (min >= 185 && chroma <= 35) return true
  if (min >= 170 && chroma <= 28) return true
  return false
}

function isCorridorGray(r, g, b) {
  const avg = (r + g + b) / 3
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)
  return avg >= 150 && avg <= 215 && chroma <= 32 && !isWall(r, g, b)
}

function findCorridorBand(data, w, h) {
  const scores = new Float64Array(h)
  for (let y = 0; y < h; y++) {
    let c = 0
    for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.92); x++) {
      const [r, g, b] = pix(data, x, y, w)
      if (isCorridorGray(r, g, b)) c++
    }
    scores[y] = c / (w * 0.82)
  }
  let bestY = Math.floor(h * 0.48)
  let best = -1
  for (let y = Math.floor(h * 0.28); y < Math.floor(h * 0.72); y++) {
    if (scores[y] > best) {
      best = scores[y]
      bestY = y
    }
  }
  let y0 = bestY
  let y1 = bestY
  while (y0 > 0 && scores[y0] > best * 0.42) y0--
  while (y1 < h - 1 && scores[y1] > best * 0.42) y1++
  // Pasillo típico ~15–25px; evitar expandir a todo el edificio
  if (y1 - y0 > 40) {
    y0 = bestY - 10
    y1 = bestY + 10
  }
  return { y0, y1, mid: bestY }
}

function buildingYSpan(data, w, h, corridor) {
  let top = 20
  let bottom = h - 20
  for (let y = 0; y < corridor.y0; y++) {
    let wallish = 0
    for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.85); x += 2) {
      const [r, g, b] = pix(data, x, y, w)
      if (isWall(r, g, b)) wallish++
    }
    if (wallish > 22) {
      top = y
      break
    }
  }
  for (let y = h - 1; y > corridor.y1; y--) {
    let wallish = 0
    for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.85); x += 2) {
      const [r, g, b] = pix(data, x, y, w)
      if (isWall(r, g, b)) wallish++
    }
    if (wallish > 22) {
      bottom = y
      break
    }
  }
  // No bajar más allá del pie del edificio (evitar acera)
  bottom = Math.min(bottom, Math.floor(h * 0.92))
  return { top, bottom }
}

function wallPeaks(data, w, y0, y1) {
  const rows = Math.max(1, y1 - y0)
  const score = new Float64Array(w)
  for (let x = 0; x < w; x++) {
    let c = 0
    let top = 0
    let bot = 0
    const mid = Math.floor((y0 + y1) / 2)
    for (let y = y0; y < y1; y++) {
      const [r, g, b] = pix(data, x, y, w)
      if (!isWall(r, g, b)) continue
      c++
      if (y < mid) top++
      else bot++
    }
    const half = rows / 2
    const spans = top / half > 0.22 && bot / half > 0.22
    score[x] = (c / rows) * (spans ? 1.55 : 0.45)
  }
  const smooth = new Float64Array(w)
  for (let x = 2; x < w - 2; x++) {
    smooth[x] = (score[x - 2] + score[x - 1] + score[x] + score[x + 1] + score[x + 2]) / 5
  }

  const raw = []
  for (let x = 8; x < w - 8; x++) {
    if (smooth[x] < 0.42) continue
    if (smooth[x] >= smooth[x - 1] && smooth[x] >= smooth[x + 1]) {
      raw.push({ x, v: smooth[x] })
    }
  }

  const clusters = []
  for (const p of raw) {
    const last = clusters[clusters.length - 1]
    if (!last || p.x - last.xs[last.xs.length - 1] > 26) {
      clusters.push({ xs: [p.x], vs: [p.v] })
    } else {
      last.xs.push(p.x)
      last.vs.push(p.v)
    }
  }

  return clusters.map((c) => {
    let sum = 0
    let wsum = 0
    for (let i = 0; i < c.xs.length; i++) {
      sum += c.xs[i] * c.vs[i]
      wsum += c.vs[i]
    }
    return { x: Math.round(sum / wsum), v: Math.max(...c.vs) }
  })
}

function pickCoreAndRight(peaks, w) {
  // Fin del núcleo: último muro fuerte en la zona de escaleras (~8–17%)
  const coreCandidates = peaks.filter((p) => p.x > w * 0.08 && p.x < w * 0.175 && p.v >= 0.9)
  let coreEnd = Math.floor(w * 0.14)
  if (coreCandidates.length) coreEnd = Math.max(...coreCandidates.map((p) => p.x))

  const rightCandidates = peaks.filter((p) => p.x > w * 0.9 && p.v >= 1.0)
  let right = Math.floor(w * 0.95)
  if (rightCandidates.length) right = rightCandidates.sort((a, b) => b.v - a.v)[0].x
  else {
    const soft = peaks.filter((p) => p.x > w * 0.88)
    if (soft.length) right = soft.sort((a, b) => b.v - a.v)[0].x
  }
  return { coreEnd, right }
}

/** Elige left + (n-1) cortes + right alineados a medianeras fuertes */
function snapUnitEdges(peaks, left, right, nUnits) {
  const span = right - left
  const ideal = span / nUnits
  const expected = Array.from({ length: nUnits - 1 }, (_, i) => left + ideal * (i + 1))
  const strong = peaks
    .filter((p) => p.v >= 1.0 && p.x > left + 40 && p.x < right - 40)
    .sort((a, b) => a.x - b.x)
  const pool = strong.length >= nUnits - 1 ? strong : peaks.filter((p) => p.x > left + 40 && p.x < right - 40)

  if (strong.length === nUnits - 1) {
    return [left, ...strong.map((p) => p.x), right]
  }

  // Si sobran medianeras, elegir la combinación más regular
  if (strong.length > nUnits - 1) {
    const k = nUnits - 1
    let bestCombo = null
    let bestScore = -Infinity
    const choose = (start, chosen) => {
      if (chosen.length === k) {
        const edges = [left, ...chosen.map((p) => p.x), right]
        let score = 0
        for (const p of chosen) score += p.v * p.v
        const widths = []
        for (let i = 0; i < edges.length - 1; i++) widths.push(edges[i + 1] - edges[i])
        const mean = widths.reduce((a, b) => a + b, 0) / widths.length
        const variance = widths.reduce((a, b) => a + (b - mean) ** 2, 0) / widths.length
        score -= (variance / (mean * mean)) * 8
        if (score > bestScore) {
          bestScore = score
          bestCombo = chosen.map((p) => p.x)
        }
        return
      }
      for (let i = start; i < strong.length; i++) {
        const p = strong[i]
        if (chosen.length) {
          const prev = chosen[chosen.length - 1].x
          if (p.x - prev < ideal * 0.45) continue
        }
        choose(i + 1, [...chosen, p])
      }
    }
    choose(0, [])
    if (bestCombo) return [left, ...bestCombo, right]
  }

  const used = new Set()
  const cuts = expected.map((ex) => {
    let best = null
    let bestScore = -1
    const maxDist = ideal * 0.55
    for (const p of pool) {
      if (used.has(p.x)) continue
      const d = Math.abs(p.x - ex)
      if (d > maxDist) continue
      const score = p.v * p.v * (1.2 - d / maxDist)
      if (score > bestScore) {
        bestScore = score
        best = p.x
      }
    }
    if (best != null) {
      used.add(best)
      return best
    }
    return Math.round(ex)
  })
  return [left, ...cuts, right]
}

function collectOpenCells(data, w, x0, x1, y0, y1) {
  const cells = []
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = pix(data, x, y, w)
      if (isWall(r, g, b) || isCorridorGray(r, g, b)) continue
      const avg = (r + g + b) / 3
      if (avg < 105) continue
      cells.push([x, y])
    }
  }
  return cells
}

/**
 * Flood desde semillas en la celda, detenido por muros y por el gris del pasillo.
 * Los cortes verticales x0/x1 contienen fugas por puertas hacia el depto vecino.
 */
function floodInBay(data, w, h, x0, y0, x1, y1) {
  const visited = new Uint8Array(w * h)
  const cells = []
  const stack = []
  const xL = x0 + 3
  const xR = x1 - 3
  const yT = y0 + 2
  const yB = y1 - 2
  const blocked = (x, y) => {
    if (x < xL || x >= xR || y < yT || y >= yB) return true
    const [r, g, b] = pix(data, x, y, w)
    if (isWall(r, g, b)) return true
    if (isCorridorGray(r, g, b)) return true
    const avg = (r + g + b) / 3
    // Acera / exterior
    if (avg < 105) return true
    return false
  }

  for (let y = yT + 6; y < yB - 6; y += 8) {
    for (let x = xL + 6; x < xR - 6; x += 8) {
      if (!blocked(x, y)) stack.push([x, y])
    }
  }
  if (!stack.length) return collectOpenCells(data, w, xL, xR, yT, yB)

  while (stack.length) {
    const [x, y] = stack.pop()
    const i = y * w + x
    if (visited[i]) continue
    visited[i] = 1
    if (blocked(x, y)) continue
    cells.push([x, y])
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }

  const bayArea = Math.max(1, (xR - xL) * (yB - yT))
  if (cells.length < bayArea * 0.18) {
    return collectOpenCells(data, w, xL, xR, yT, yB)
  }

  // Erosión 1px: quita el “spray” sobre el filo del muro
  const set = new Set(cells.map(([x, y]) => (y << 16) | x))
  const eroded = []
  for (const [x, y] of cells) {
    if (
      set.has((y << 16) | (x - 1)) &&
      set.has((y << 16) | (x + 1)) &&
      set.has(((y - 1) << 16) | x) &&
      set.has(((y + 1) << 16) | x)
    ) {
      eroded.push([x, y])
    }
  }
  return eroded.length > cells.length * 0.5 ? eroded : cells
}

function contourFromCells(cells, w, h) {
  if (cells.length < 50) return null
  const set = new Set(cells.map(([x, y]) => (y << 16) | x))
  const has = (x, y) => set.has((y << 16) | x)
  const boundary = []
  for (const [x, y] of cells) {
    if (!has(x - 1, y) || !has(x + 1, y) || !has(x, y - 1) || !has(x, y + 1)) {
      boundary.push([x, y])
    }
  }
  if (boundary.length < 10) return null

  const cx = boundary.reduce((s, p) => s + p[0], 0) / boundary.length
  const cy = boundary.reduce((s, p) => s + p[1], 0) / boundary.length
  const BINS = 128
  const bins = Array.from({ length: BINS }, () => null)
  for (const [x, y] of boundary) {
    let ang = Math.atan2(y - cy, x - cx)
    if (ang < 0) ang += Math.PI * 2
    const bi = Math.min(BINS - 1, Math.floor((ang / (Math.PI * 2)) * BINS))
    const dist = Math.hypot(x - cx, y - cy)
    if (!bins[bi] || dist > bins[bi].d) bins[bi] = { x, y, d: dist }
  }
  const ring = bins.filter(Boolean)
  if (ring.length < 8) return null

  const simplified = []
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length]
    const cur = ring[i]
    const next = ring[(i + 1) % ring.length]
    const ax = cur.x - prev.x
    const ay = cur.y - prev.y
    const bx = next.x - cur.x
    const by = next.y - cur.y
    if (Math.abs(ax * by - ay * bx) > 10 || ax * bx + ay * by <= 0 || simplified.length < 5) {
      simplified.push(cur)
    }
  }
  const use = simplified.length >= 6 ? simplified : ring
  return use.map((p) => `${((p.x / w) * 100).toFixed(2)},${((p.y / h) * 100).toFixed(2)}`).join(' ')
}

function segmentBand(data, w, h, y0, y1, peaks, rowPrefix, startOrder) {
  const { coreEnd, right } = pickCoreAndRight(peaks, w)
  const edges = snapUnitEdges(peaks, coreEnd, right, UNITS_PER_ROW)
  console.log(rowPrefix, 'edges', edges, 'peaks', peaks.map((p) => `${p.x}:${p.v.toFixed(2)}`).join(','))

  const slots = []
  let order = startOrder
  for (let i = 0; i < edges.length - 1; i++) {
    const x0 = edges[i]
    const x1 = edges[i + 1]
    if (x1 - x0 < 40) continue
    const cells = floodInBay(data, w, h, x0, y0, x1, y1)
    if (cells.length < 400) continue
    const points = contourFromCells(cells, w, h)
    if (!points) continue
    slots.push({
      id: `${rowPrefix}${i + 1}`,
      label: `${rowPrefix.toUpperCase()}${i + 1}`,
      order,
      points,
      cells,
      meta: { x0, x1, y0, y1, cells: cells.length },
    })
    order += 1
  }
  return { slots, order, edges }
}

async function main() {
  const { data, info } = await sharp(INPUT).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const corridor = findCorridorBand(data, w, h)
  const { top, bottom } = buildingYSpan(data, w, h, corridor)
  console.log('corridor', corridor, 'ySpan', { top, bottom })

  const northPeaks = wallPeaks(data, w, top + 2, corridor.y0 - 1)
  const southPeaks = wallPeaks(data, w, corridor.y1 + 1, bottom - 1)

  const north = segmentBand(data, w, h, top + 1, corridor.y0 - 2, northPeaks, 'n', 0)
  const south = segmentBand(data, w, h, corridor.y1 + 3, bottom, southPeaks, 's', north.order)
  const slots = [...north.slots, ...south.slots]
  console.log(
    `units=${slots.length}`,
    slots.map((s) => `${s.id}(${s.meta.cells})`).join(', '),
  )

  const mask = Buffer.alloc(w * h * 3, 36)
  const overlay = Buffer.from(data)
  const palette = [
    [220, 80, 80, 130],
    [80, 180, 90, 130],
    [80, 120, 230, 130],
    [230, 180, 60, 130],
    [190, 80, 210, 130],
    [60, 200, 200, 130],
    [210, 120, 60, 130],
    [120, 200, 140, 130],
    [210, 80, 140, 130],
    [140, 140, 230, 130],
  ]

  for (let y = corridor.y0; y <= corridor.y1; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      mask[o] = 70
      mask[o + 1] = 70
      mask[o + 2] = 78
    }
  }

  slots.forEach((slot, si) => {
    const c = palette[si % palette.length]
    for (const [x, y] of slot.cells) {
      const p = (y * w + x) * 4
      const o = (y * w + x) * 3
      mask[o] = c[0]
      mask[o + 1] = c[1]
      mask[o + 2] = c[2]
      const a = c[3] / 255
      overlay[p] = Math.round(data[p] * (1 - a) + c[0] * a)
      overlay[p + 1] = Math.round(data[p + 1] * (1 - a) + c[1] * a)
      overlay[p + 2] = Math.round(data[p + 2] * (1 - a) + c[2] * a)
    }
  })

  await sharp(mask, { raw: { width: w, height: h, channels: 3 } }).png().toFile(MASK_OUT)
  await sharp(overlay, { raw: { width: w, height: h, channels: 4 } }).png().toFile(OVERLAY_OUT)

  const ts = `/* AUTO-GENERATED by scripts/segment-floor-plan.mjs — no editar a mano */
export type GeneratedFloorPlanSlot = {
  id: string
  label: string
  order: number
  points: string
}

export const GENERATED_FLOOR_PLAN_SLOTS: GeneratedFloorPlanSlot[] = ${JSON.stringify(
    slots.map(({ id, label, order, points }) => ({ id, label, order, points })),
    null,
    2,
  )}
`
  fs.writeFileSync(TS_OUT, ts, 'utf8')
  console.log(`mask → ${MASK_OUT}`)
  console.log(`overlay → ${OVERLAY_OUT}`)
  console.log(`slots → ${TS_OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
