import { HeroStage } from './HeroStage'
import { LaviletStory } from './LaviletStory'
import { LockupProvider } from './LaviletLockup'
import { HomeTourSection } from './HomeTourSection'

/** Landing Lavilet: hero, nosotros y entrada al showroom 360°. */
export function FullLanding({ unitDeepLink = false }: { unitDeepLink?: boolean }) {
  return (
    <>
      <LockupProvider>
        <HeroStage />
        <LaviletStory />
      </LockupProvider>
      <HomeTourSection embedded scrollToShowroom={unitDeepLink} tourHref="/tour" />
    </>
  )
}
