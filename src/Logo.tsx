import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import SplitType from 'split-type'

export function Logo() {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let nameSplit: SplitType | undefined

    const ctx = gsap.context(() => {
      nameSplit = new SplitType('#logo-name')

      if (!nameSplit.chars?.length) return

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

    return () => {
      ctx.revert()
      if (nameSplit) nameSplit.revert()
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className="leading-tight font-['Doto',ui-sans-serif,system-ui]"
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

