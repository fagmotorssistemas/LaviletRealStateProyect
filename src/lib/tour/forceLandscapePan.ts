import type { Viewer } from '@photo-sphere-viewer/core'

const DEG2RAD = Math.PI / 180
const DRAG_THRESHOLD_PX = 6

type RemapPanOptions = {
  /** true mientras el root usa CSS rotate(90deg) fake-landscape */
  active: () => boolean
  /** Sensibilidad extra en celular */
  speedMult?: number
  inertia?: number
}

/**
 * Con CSS `rotate(90deg)` (force landscape en portrait), Photo Sphere Viewer
 * lee clientX/Y en espacio de pantalla: el swipe visual vertical mueve yaw.
 * Remapeamos screen → local del contenedor rotado 90° CW:
 *   localDx = screenDy, localDy = -screenDx
 */
export function attachForceLandscapePan(viewer: Viewer, options: RemapPanOptions) {
  const el = viewer.container
  const speedMult = options.speedMult ?? 1.35
  const inertia = options.inertia ?? 0.45

  let dragging = false
  let moved = false
  let lastX = 0
  let lastY = 0
  let velYaw = 0
  let velPitch = 0
  let raf = 0
  let pointerId: number | null = null
  let suppressClickUntil = 0

  const stopInertia = () => {
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    velYaw = 0
    velPitch = 0
  }

  const tickInertia = () => {
    raf = 0
    if (Math.abs(velYaw) < 1e-4 && Math.abs(velPitch) < 1e-4) {
      velYaw = 0
      velPitch = 0
      return
    }
    try {
      const pos = viewer.getPosition()
      viewer.rotate({
        yaw: pos.yaw - velYaw,
        pitch: pos.pitch + velPitch,
      })
    } catch {
      stopInertia()
      return
    }
    velYaw *= inertia
    velPitch *= inertia
    raf = requestAnimationFrame(tickInertia)
  }

  const applyDelta = (screenDx: number, screenDy: number) => {
    // rotate(90deg) CW: screen → local del stage
    const x = screenDy
    const y = -screenDx
    const size = viewer.getSize()
    if (!size.width || !size.height) return
    const moveSpeed = (viewer.config.moveSpeed ?? 1) * speedMult
    const { hFov, vFov } = viewer.state
    const yaw = moveSpeed * (x / size.width) * hFov * DEG2RAD
    const pitch = moveSpeed * (y / size.height) * vFov * DEG2RAD
    velYaw = yaw
    velPitch = pitch
    try {
      const pos = viewer.getPosition()
      viewer.rotate({
        yaw: pos.yaw - yaw,
        pitch: pos.pitch + pitch,
      })
    } catch {
      /* viewer destruido */
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!options.active()) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (pointerId != null) return
    dragging = true
    moved = false
    pointerId = event.pointerId
    lastX = event.clientX
    lastY = event.clientY
    stopInertia()
    try {
      el.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    void viewer.stopAnimation()
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== pointerId) return
    if (!options.active()) return
    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    moved = true
    lastX = event.clientX
    lastY = event.clientY
    event.preventDefault()
    applyDelta(dx, dy)
  }

  const onPointerUpCapture = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    if (moved) suppressClickUntil = Date.now() + 350
  }

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    const wasMoved = moved
    dragging = false
    moved = false
    pointerId = null
    try {
      el.releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    if (wasMoved && (Math.abs(velYaw) > 1e-4 || Math.abs(velPitch) > 1e-4)) {
      raf = requestAnimationFrame(tickInertia)
    }
  }

  const onClickCapture = (event: MouseEvent) => {
    if (!options.active()) return
    if (Date.now() < suppressClickUntil) {
      event.stopPropagation()
      event.preventDefault()
    }
  }

  el.addEventListener('pointerdown', onPointerDown, { passive: true })
  el.addEventListener('pointermove', onPointerMove, { passive: false })
  el.addEventListener('pointerup', onPointerUpCapture, true)
  el.addEventListener('pointercancel', onPointerUpCapture, true)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', onPointerUp)
  el.addEventListener('click', onClickCapture, true)

  return () => {
    stopInertia()
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUpCapture, true)
    el.removeEventListener('pointercancel', onPointerUpCapture, true)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointercancel', onPointerUp)
    el.removeEventListener('click', onClickCapture, true)
  }
}
