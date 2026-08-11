import type { RotationPolicy } from './types'
import { DEFAULT_ROTATION, ORTHOGONAL_ANGLES } from './types'
import { canonicalizeAngle, normalizeDeg } from './angle'
import { DEFAULT_ANGLE_PRECISION } from './types'

/**
 * Expand discrete policies to an angle list.
 * `{ kind: 'free' }` returns [] — use `searchFreeAngle` instead.
 */
export function anglesForPolicy(
  policy: RotationPolicy = DEFAULT_ROTATION,
): number[] {
  switch (policy.kind) {
    case 'none':
      return [0]
    case 'fixed': {
      const uniq = [
        ...new Set(
          policy.anglesDeg.map((a) =>
            canonicalizeAngle(a, DEFAULT_ANGLE_PRECISION),
          ),
        ),
      ]
      uniq.sort((a, b) => a - b)
      return uniq.length ? uniq : [0]
    }
    case 'orthogonal':
      return [...ORTHOGONAL_ANGLES]
    case 'free':
      return []
    default: {
      const _exhaustive: never = policy
      void _exhaustive
      return [0]
    }
  }
}

export { normalizeDeg }
