'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { LayoutGroup, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { BrandLetter } from './BrandName'

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

const TILE_BORDER: Record<string, string> = {
  'lockup-L-la': 'var(--color-lv-line)',
  'lockup-A-la': 'var(--color-lv-ink-soft)',
  'lockup-V-v0': 'var(--color-lv-line)',
  'lockup-I-v1': 'var(--color-lv-line)',
  'lockup-L-v2': 'var(--color-lv-bronze)',
  'lockup-E-v3': 'var(--color-lv-ink-soft)',
  'lockup-T-v4': 'var(--color-lv-line)',
}

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
  quiet = false,
  noLayoutId = false,
}: {
  id: string
  letter: string
  index: number
  variant: 'hero' | 'story'
  quiet?: boolean
  noLayoutId?: boolean
  heroPalette?: boolean
}) {
  const story = variant === 'story'
  const tile = story ? TILE_BORDER[id] : undefined
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024

  return (
    <motion.span
      layoutId={isMobile || noLayoutId ? undefined : id}
      className={cn(
        'inline-block cursor-pointer select-none',
        tile &&
          'inline-flex h-[3.6rem] w-[2.85rem] items-center justify-center border bg-lv-bg font-lv-display text-[2.35rem] font-normal leading-none text-lv-ink sm:h-[4.8rem] sm:w-[3.8rem] sm:text-[3.2rem] lg:h-[5.8rem] lg:w-[4.6rem] lg:text-[3.9rem]',
      )}
      style={tile ? { borderColor: tile } : undefined}
      initial={story ? { opacity: 0, x: -40 } : { y: 140, scale: 1.85, opacity: 0 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      whileHover={
        quiet
          ? undefined
          : {
              y: story ? -6 : -18,
              scale: story ? 1.06 : 1.22,
              transition: { type: 'spring', stiffness: 620, damping: 9, delay: 0 },
            }
      }
      whileTap={
        quiet
          ? undefined
          : {
              y: -14,
              scale: 1.18,
              transition: { type: 'spring', stiffness: 800, damping: 11, delay: 0 },
            }
      }
      transition={{
        layout: {
          type: 'spring',
          stiffness: 380,
          damping: 12,
          mass: 0.65,
          delay: index * 0.11,
        },
        x: {
          type: 'spring',
          stiffness: 380,
          damping: 25,
          delay: index * 0.08,
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
        opacity: {
          duration: 0.4,
          delay: index * 0.08,
        }
      }}
    >
      <BrandLetter letter={letter} />
    </motion.span>
  )
}

export function LaviletLockup({
  variant,
  onMist = false,
  backdrop = false,
  noLayoutId = false,
  heroPalette = false,
}: {
  variant: 'hero' | 'story'
  onMist?: boolean
  backdrop?: boolean
  noLayoutId?: boolean
  heroPalette?: boolean
}) {
  const story = variant === 'story'
  const mist = story || onMist

  return (
    <div
      role="img"
      aria-label="La Vilēt"
      className={cn(
        'flex w-fit flex-col items-start origin-left',
        heroPalette
          ? 'text-lv-ink-soft'
          : story
          ? 'text-lv-ink-soft mkt-dark:text-[#F2F2F2]'
          : backdrop || (mist && variant === 'hero')
            ? 'text-lv-ink mkt-dark:text-[#F2F2F2]'
            : mist
              ? 'text-lv-ink-soft mkt-dark:text-[#F2F2F2]'
              : 'text-lv-ink',
      )}
      style={
        backdrop
          ? {
              filter:
                'drop-shadow(0 1px 0 rgb(242 242 242)) drop-shadow(0 0 14px rgb(242 242 242 / 0.9)) drop-shadow(0 8px 22px rgb(242 242 242 / 0.75))',
            }
          : undefined
      }
    >
      <motion.p
        layoutId={noLayoutId ? undefined : "lockup-suites"}
        className={cn(
          'mb-3 font-lv-text font-normal tracking-[0.22em] uppercase',
          story
            ? 'hidden'
              : backdrop
              ? 'text-[10px] text-lv-ink-soft sm:text-xs mkt-dark:text-[#F2F2F2]/80'
              : mist
                ? 'text-[10px] text-lv-ink-soft sm:text-xs mkt-dark:text-[#F2F2F2]/75'
                : 'text-[10px] text-lv-ink sm:text-xs',
        )}
      >
        Suites | Apartments
      </motion.p>
      <div
        className={cn(
          'font-lv-display font-normal leading-[0.85] tracking-[-0.04em]',
          heroPalette && 'tracking-[0.04em]',
          backdrop ? 'flex w-fit' : 'grid w-fit grid-cols-[auto_auto] grid-rows-2',
          story
            ? 'text-[clamp(3.25rem,8vw,5.25rem)]'
            : backdrop
              ? 'text-[clamp(2.35rem,8vw+2vh,7.5rem)]'
              : 'text-[clamp(3.25rem,13vw,8rem)]',
        )}
      >
        {backdrop ? (
          <>
            {LETTERS_LA.map((item, i) => (
              <LockupLetter
                key={item.id}
                id={item.id}
                letter={item.ch}
                index={i}
                variant={variant}
                quiet
                noLayoutId={noLayoutId}
                heroPalette={heroPalette}
              />
            ))}
            {LETTERS_VILET.map((item, i) => (
              <LockupLetter
                key={item.id}
                id={item.id}
                letter={item.ch}
                index={i + 2}
                variant={variant}
                quiet
                noLayoutId={noLayoutId}
                heroPalette={heroPalette}
              />
            ))}
          </>
        ) : (
          <>
            <span className={cn('col-start-1 row-start-1 flex gap-1 sm:gap-1.5', !story && 'gap-1.5 sm:gap-2')}>
              {LETTERS_LA.map((item, i) => (
                <LockupLetter
                  key={item.id}
                  id={item.id}
                  letter={item.ch}
                  index={i}
                  variant={variant}
                  noLayoutId={noLayoutId}
                  heroPalette={heroPalette}
                />
              ))}
            </span>
            <span className={cn('col-start-2 row-start-2 flex gap-1 sm:gap-1.5', !story && 'gap-1.5 sm:gap-2')}>
              {LETTERS_VILET.map((item, i) => (
                <LockupLetter
                  key={item.id}
                  id={item.id}
                  letter={item.ch}
                  index={i + 2}
                  variant={variant}
                  noLayoutId={noLayoutId}
                  heroPalette={heroPalette}
                />
              ))}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
