import type { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin'

type Dir = { x: number; y: number; z: number }
type Position = { yaw: number; pitch: number }

const direction: Dir = { x: 0, y: 0, z: 0 }
const DEADZONE = 0.018
const FOLLOW = 0.08
const STEP = 1.15

type GyroInternals = {
  __onBeforeRender: () => void
  __lvStabilized?: boolean
  isEnabled: () => boolean
  state: { alphaOffset: number | null }
  controls?: {
    update: () => boolean
    object: { getWorldDirection: (v: Dir) => void }
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
    if (!plugin.isEnabled() || !plugin.controls?.deviceOrientation) return

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
