import { HeroStage } from './HeroStage'
import { LaviletStory } from './LaviletStory'
import { LockupProvider } from './LaviletLockup'

export function NosotrosView() {
  return (
    <LockupProvider>
      <HeroStage />
      <LaviletStory />
    </LockupProvider>
  )
}
