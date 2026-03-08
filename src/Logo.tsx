import { useCallback, useEffect, useRef } from 'react'
import gsap from 'gsap'
import SplitType from 'split-type'

export function Logo() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<{ ctx: gsap.Context; nameSplit: SplitType } | null>(null)

  const runAnimation = useCallback(() => {
    const root = rootRef.current
    if (!root) return

    if (stateRef.current) {
      stateRef.current.ctx.revert()
      stateRef.current.nameSplit.revert()
      stateRef.current = null
    }

    const nameSplit = new SplitType('#logo-name')
    if (!nameSplit.chars?.length) return

    const ctx = gsap.context(() => {
      gsap.to(nameSplit.chars, {
        duration: 0.05,
        fontWeight: 800,
        opacity: 1,
        stagger: {
          each: 0.07,
          from: 'random',
          repeat: 22,
          yoyo: true,
        },
      })

      gsap.to(nameSplit.chars, {
        delay: 1.9,
        duration: 2.5,
        fontWeight: 100,
        color: '#c97979',
        ease: 'rough',
        stagger: {
          from: 'random',
          each: 0.6,
          repeat: 30,
          yoyo: true,
        },
      })
    }, root)

    stateRef.current = { ctx, nameSplit }
  }, [])

  useEffect(() => {
    runAnimation()
    return () => {
      if (stateRef.current) {
        stateRef.current.ctx.revert()
        stateRef.current.nameSplit.revert()
      }
    }
  }, [runAnimation])

  return (
    <div
      ref={rootRef}
      onClick={runAnimation}
      className="leading-tight font-['Doto',ui-sans-serif,system-ui] cursor-pointer"
    >
      <h1
        id="logo-name"
        className="text-[3em] font-thin text-white sm:text-[4em]"
      >
        shaul
        <br />
        bar-lev
      </h1>
    </div>
  )
}

