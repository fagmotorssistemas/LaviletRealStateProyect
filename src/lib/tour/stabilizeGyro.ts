import type { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin'

/** Hay que llamarlo en el mismo toque del usuario. En iOS `pointerdown` no vale. */
export function requestGyroPermission() {
  const DOE = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<string>
  }
  if (typeof DOE.requestPermission !== 'function') return Promise.resolve(true)
  try {
    return DOE.requestPermission().then((result) => result === 'granted')
  } catch {
    return Promise.resolve(false)
  }
}

type Position = { yaw: number; pitch: number }

const DEADZONE = 0.006
const FOLLOW = 0.22
const STEP = 2.4

class Dir {
  x = 0
  y = 0
  z = 0

  set(x: number, y: number, z: number) {
    this.x = x
    this.y = y
    this.z = z
    return this
  }

  normalize() {
    const length = Math.hypot(this.x, this.y, this.z) || 1
    this.x /= length
    this.y /= length
    this.z /= length
    return this
  }
}

const direction = new Dir()

type GyroInternals = {
  __onBeforeRender: () => void
  __lvStabilized?: boolean
  isEnabled: () => boolean
  state: { alphaOffset: number | null }
  controls?: {
    update: () => boolean
    object: { getWorldDirection: (v: Dir) => Dir }
    alphaOffset: number
    deviceOrientation?: unknown
  }
  viewer: {
    getPosition: () => Position
    dataHelper: { vector3ToSphericalCoords: (vector: Dir) => Position }
    dynamics: { position: { goto: (position: Position, speed: number) => void } }
  }
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount
}

function lerpAngle(from: number, to: number, amount: number) {
  let delta = to - from
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * amount
}

export function stabilizeTourGyro(gyro: GyroscopePlugin) {
  const plugin = gyro as unknown as GyroInternals
  if (plugin.__lvStabilized) return
  plugin.__lvStabilized = true

  let yaw = Number.NaN
  let pitch = Number.NaN

  plugin.__onBeforeRender = () => {
    if (!plugin.isEnabled() || !plugin.controls) return

    const position = plugin.viewer.getPosition()
    if (plugin.state.alphaOffset === null) {
      if (plugin.controls.update()) {
        plugin.controls.object.getWorldDirection(direction)
        const spherical = plugin.viewer.dataHelper.vector3ToSphericalCoords(direction)
        plugin.state.alphaOffset = spherical.yaw - position.yaw
      }
      yaw = Number.NaN
      pitch = Number.NaN
      return
    }

    plugin.controls.alphaOffset = plugin.state.alphaOffset
    if (!plugin.controls.update()) return

    plugin.controls.object.getWorldDirection(direction)
    const spherical = plugin.viewer.dataHelper.vector3ToSphericalCoords(direction)
    const nextYaw = spherical.yaw
    const nextPitch = -spherical.pitch

    if (!Number.isFinite(yaw)) {
      yaw = nextYaw
      pitch = nextPitch
    } else {
      yaw = lerpAngle(yaw, nextYaw, FOLLOW)
      pitch = lerp(pitch, nextPitch, FOLLOW)
    }

    const gap = Math.hypot(
      Math.atan2(Math.sin(yaw - position.yaw), Math.cos(yaw - position.yaw)),
      pitch - position.pitch,
    )
    if (gap < DEADZONE) return

    plugin.viewer.dynamics.position.goto({ yaw, pitch }, STEP)
  }
}
