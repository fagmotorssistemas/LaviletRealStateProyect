import { HeroStage } from './HeroStage'
import { LaviletPlaceBoard, LaviletStory } from './LaviletStory'
import { LockupProvider } from './LaviletLockup'
import { HomeTourSection } from './HomeTourSection'
import { LandingWash } from './LandingWash'
import { LifestyleStrip } from './LifestyleStrip'
import { ExploreFloors } from './ExploreFloors'

/** Landing Lavilet: hero, nosotros y entrada al showroom 360°. */
export function FullLanding({ unitDeepLink = false }: { unitDeepLink?: boolean }) {
  return (
    <LockupProvider>
      <HeroStage />
      <LandingWash>
        <LaviletStory />
        <ExploreFloors />
        <LifestyleStrip />
        <HomeTourSection embedded scrollToShowroom={unitDeepLink} tourHref="/tour" />
        <LaviletPlaceBoard />
      </LandingWash>
    </LockupProvider>
  )
}
