import { HeroStage } from './HeroStage'
import { LaviletPlaceBoard, LaviletStory } from './LaviletStory'
import { LockupProvider } from './LaviletLockup'
import { LandingWash } from './LandingWash'
import { LifestyleStrip } from './LifestyleStrip'
import { UbicanosView } from './UbicanosView'
import { WhyLavilet } from './WhyLavilet'
import { ProjectEssentials } from './ProjectEssentials'
import { EspaciosAccordion } from './EspaciosAccordion'

/** Landing Lavilet: hero, nosotros y entrada al showroom 360°. */
export function FullLanding() {
  return (
    <LockupProvider>
      <HeroStage />
      <LandingWash>
        <WhyLavilet part="overview" />
        <LaviletStory />
        <WhyLavilet part="reasons" />
        <LifestyleStrip />
        <LaviletPlaceBoard />
        <UbicanosView project={null} />
        <EspaciosAccordion />
        <ProjectEssentials />
      </LandingWash>
    </LockupProvider>
  )
}
