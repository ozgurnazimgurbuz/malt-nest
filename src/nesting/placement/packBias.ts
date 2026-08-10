/**
 * Pack-bias preference for BLF candidate / variant ordering only.
 * Does not change NFP, collision, spacing, or geometry.
 *
 * Sheet coords match NestPreview SVG: x→right, y→down (origin top-left).
 *
 * Engine flags are axis letters; UI edge names map the other way:
 * - dayamaX → Dikey Dayama (vertical sheet edges / left–right) → prefer smaller x
 * - dayamaY → Yatay Dayama (horizontal sheet edges / top–bottom) → prefer smaller y
 *
 * Default both on: Y then X (historic BLF / visual top-left pack).
 */

export type PackBias = {
  /** Prefer vertical edges: smaller x (left). UI: Dikey Dayama. */
  dayamaX: boolean
  /** Prefer horizontal edges: smaller y (top). UI: Yatay Dayama. */
  dayamaY: boolean
}

export const DEFAULT_PACK_BIAS: PackBias = { dayamaX: true, dayamaY: true }

export function resolvePackBias(partial?: Partial<PackBias> | null): PackBias {
  return {
    dayamaX: partial?.dayamaX !== false,
    dayamaY: partial?.dayamaY !== false,
  }
}

type Pt = { x: number; y: number }

/**
 * Comparator for placement translations.
 * When both biases on: Y then X (preserves prior BLF order).
 * When both off: 0 (stable / insertion order).
 */
export function compareByPackBias(
  a: Pt,
  b: Pt,
  bias: PackBias,
  edge?: { minX: number; minY: number },
): number {
  const { dayamaX, dayamaY } = bias
  if (dayamaY && a.y !== b.y) return a.y - b.y
  if (dayamaX && a.x !== b.x) return a.x - b.x

  if (edge) {
    const eps = 1e-6
    if (dayamaY) {
      const aEdge = Math.abs(a.y - edge.minY) < eps ? 0 : 1
      const bEdge = Math.abs(b.y - edge.minY) < eps ? 0 : 1
      if (aEdge !== bEdge) return aEdge - bEdge
    }
    if (dayamaX) {
      const aEdge = Math.abs(a.x - edge.minX) < eps ? 0 : 1
      const bEdge = Math.abs(b.x - edge.minX) < eps ? 0 : 1
      if (aEdge !== bEdge) return aEdge - bEdge
    }
  }
  return 0
}
