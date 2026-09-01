'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { LayoutGroup, motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export const LETTERS_LA = [
  { id: 'lockup-L-la', ch: 'L' },
  { id: 'lockup-A-la', ch: 'a' },
] as const

export const LETTERS_VILET = [
  { id: 'lockup-V-v0', ch: 'V' },
  { id: 'lockup-I-v1', ch: 'i' },
  { id: 'lockup-L-v2', ch: 'l' },
  { id: 'lockup-E-v3', ch: 'ē' },
  { id: 'lockup-T-v4', ch: 't' },
] as const

const Dock = createContext({ docked: false })

export function useLockupDocked() {
  return useContext(Dock).docked
}

export function LockupProvider({ children }: { children: ReactNode }) {
  const [docked, setDocked] = useState(false)

  useEffect(() => {
    const update = () => {
      const story = document.getElementById('nosotros')
      if (!story) return
      setDocked(story.getBoundingClientRect().top < window.innerHeight * 0.58)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return (
    <Dock.Provider value={{ docked }}>
      <LayoutGroup id="lavilet-lockup-group">{children}</LayoutGroup>
    </Dock.Provider>
  )
}

function LockupLetter({
  id,
  letter,
  index,
  variant,
}: {
  id: string
  letter: string
  index: number
  variant: 'hero' | 'story'
}) {
  const story = variant === 'story'

  return (
    <motion.span
      layoutId={id}
      className="inline-block cursor-pointer select-none"
      initial={story ? false : { y: 140, scale: 1.85, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      whileHover={{
        y: story ? -6 : -18,
        scale: story ? 1.06 : 1.22,
        transition: { type: 'spring', stiffness: 620, damping: 9, delay: 0 },
      }}
      whileTap={{
        y: -14,
        scale: 1.18,
        transition: { type: 'spring', stiffness: 800, damping: 11, delay: 0 },
      }}
      transition={{
        layout: {
          type: 'spring',
          stiffness: 380,
          damping: 12,
          mass: 0.65,
          delay: index * 0.11,
        },
        y: {
          type: 'spring',
          stiffness: story ? 420 : 780,
          damping: story ? 12 : 16,
          mass: 0.7,
          delay: story ? index * 0.11 : 0.2 + index * 0.11,
        },
        scale: {
          type: 'spring',
          stiffness: story ? 420 : 780,
          damping: story ? 12 : 16,
          delay: story ? index * 0.11 : 0.2 + index * 0.11,
        },
      }}
    >
      {letter}
    </motion.span>
  )
}

export function LaviletLockup({ variant }: { variant: 'hero' | 'story' }) {
  const story = variant === 'story'

  return (
    <div
      className={cn(
        'flex w-fit flex-col items-start',
        story ? 'text-[#787D62]' : 'origin-left text-white',
      )}
    >
      <motion.p
        layoutId="lockup-suites"
        className={cn(
          'mb-3 font-sans font-medium tracking-[0.42em] uppercase',
          story ? 'text-[9px] sm:text-[10px]' : 'text-[10px] text-white/80 sm:text-xs',
        )}
      >
        Suites | Apartments
      </motion.p>
      <div
        className={cn(
          'grid w-fit grid-cols-[auto_auto] grid-rows-2 font-serif font-normal leading-[0.85] tracking-[-0.04em]',
          story
            ? 'text-[clamp(3.25rem,8vw,5.25rem)]'
            : 'text-[clamp(3.25rem,13vw,8rem)]',
        )}
      >
        <span className="col-start-1 row-start-1 flex">
          {LETTERS_LA.map((item, i) => (
            <LockupLetter
              key={item.id}
              id={item.id}
              letter={item.ch}
              index={i}
              variant={variant}
            />
          ))}
        </span>
        <span className="col-start-2 row-start-2 flex">
          {LETTERS_VILET.map((item, i) => (
            <LockupLetter
              key={item.id}
              id={item.id}
              letter={item.ch}
              index={i + 2}
              variant={variant}
            />
          ))}
        </span>
      </div>
    </div>
  )
}
