/** Seeded PRNG (Mulberry32). Deterministic across runs. */
export type Rng = {
  next: () => number
  int: (maxExclusive: number) => number
  pick: <T>(items: readonly T[]) => T
  shuffle: <T>(items: T[]) => T[]
  chance: (p: number) => boolean
}

export function createRng(seed: number): Rng {
  let s = (seed >>> 0) || 1
  const next = (): number => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int(maxExclusive: number) {
      if (maxExclusive <= 0) return 0
      return Math.floor(next() * maxExclusive)
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)]!
    },
    shuffle<T>(items: T[]): T[] {
      const a = items.slice()
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = a[i]!
        a[i] = a[j]!
        a[j] = tmp
      }
      return a
    },
    chance(p: number) {
      return next() < p
    },
  }
}
