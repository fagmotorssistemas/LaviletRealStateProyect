import { HeroStage } from './HeroStage'
import { LaviletPlaceBoard, LaviletStory } from './LaviletStory'
import { LockupProvider } from './LaviletLockup'
import { LandingWash } from './LandingWash'
import { LifestyleStrip } from './LifestyleStrip'
import { ExperienceLiving } from './ExperienceLiving'
import { ExploreFloors } from './ExploreFloors'
import { UbicanosView } from './UbicanosView'
import { WhyLavilet } from './WhyLavilet'

/** Landing Lavilet: hero, nosotros y entrada al showroom 360°. */
export function FullLanding() {
  return (
    <LockupProvider>
      <HeroStage />
      <LandingWash>
        <LaviletStory />
        <WhyLavilet />
        <ExploreFloors />
        <LifestyleStrip />
        <ExperienceLiving />
        <LaviletPlaceBoard />
        <UbicanosView project={null} />
      </LandingWash>
    </LockupProvider>
  )
}
