import { HeroStage } from './HeroStage'
import { LaviletPlaceBoard, LaviletStory } from './LaviletStory'
import { LockupProvider } from './LaviletLockup'
import { LandingWash } from './LandingWash'
import { LifestyleStrip } from './LifestyleStrip'
import { ExploreFloors } from './ExploreFloors'

export function NosotrosView() {
  return (
    <LockupProvider>
      <HeroStage />
      <LandingWash>
        <LaviletStory />
        <ExploreFloors />
        <LifestyleStrip />
        <LaviletPlaceBoard />
      </LandingWash>
    </LockupProvider>
  )
}
