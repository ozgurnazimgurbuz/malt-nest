/**
 * Pack-bias preference for BLF candidate / variant ordering only.
 * Does not change NFP, collision, spacing, or geometry.
 *
 * Sheet coords match NestPreview SVG: x→right, y→down (origin top-left).
 * Default (dayamaX+dayamaY): prefer smaller x then — with Y primary — smaller y
 * (engine’s historic “bottom-left” sort = visual top-left on the SVG board).
 */

export type PackBias = {
  /** Horizontal preference (X). true → prefer smaller x (left). */
  dayamaX: boolean
  /** Vertical preference (Y). true → prefer smaller y (toward SVG top / IFP minY). */
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
