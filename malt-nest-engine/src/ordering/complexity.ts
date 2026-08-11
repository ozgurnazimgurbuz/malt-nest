import type { Shape } from '../geometry/types'

/**
 * Deterministic shape complexity for `complexity_desc` ordering.
 *
 *   complexity = V + 10·H + C
 *
 * - **V** — total vertex count (all outers + holes)
 * - **H** — hole count
 * - **C** — concave (reflex) vertex count on outer rings
 *
 * Reflex test: at vertex B of A→B→C, cross (B−A)×(C−B) ≤ 0 ⇒ right turn
 * in SVG axes for CCW outers ⇒ concave.
 *
 * Integers only — no perimeter/area blend. See docs/optimization.md.
 */
export function shapeComplexity(shape: Shape): number {
  let V = 0
  let H = 0
  let C = 0
  for (const poly of shape.polygons) {
    V += poly.outer.length
    C += reflexCount(poly.outer)
    for (const hole of poly.holes) {
      H += 1
      V += hole.length
    }
  }
  return V + 10 * H + C
}

function reflexCount(ring: readonly { x: number; y: number }[]): number {
  const n = ring.length
  if (n < 3) return 0
  let c = 0
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]!
    const b = ring[i]!
    const d = ring[(i + 1) % n]!
    const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x)
    if (cross <= 0) c++
  }
  return c
}
