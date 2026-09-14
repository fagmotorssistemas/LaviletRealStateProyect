export const HERO_LOCKED_EVENT = 'lavilet-hero-locked'

let locked = false

export function isHeroLocked() {
  return locked
}

export function resetHeroLock() {
  locked = false
}

export function notifyHeroLocked() {
  locked = true
  window.dispatchEvent(new Event(HERO_LOCKED_EVENT))
}
