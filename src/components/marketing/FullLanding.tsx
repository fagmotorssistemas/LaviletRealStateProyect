import { HeroStage } from './HeroStage'
import { LaviletStory } from './LaviletStory'
import { LockupProvider } from './LaviletLockup'
import { HomeTourSection } from './HomeTourSection'

/** Landing Lavilet: hero, nosotros y showroom. El resto vive en rutas propias. */
export function FullLanding() {
  return (
    <>
      <LockupProvider>
        <HeroStage />
        <LaviletStory />
      </LockupProvider>
      <HomeTourSection embedded />
    </>
  )
}
