export type {
  AnglePrecision,
  FreeAngleConfig,
  RotationPolicy,
} from './types'
export {
  DEFAULT_ANGLE_PRECISION,
  DEFAULT_FREE_ANGLE,
  DEFAULT_ROTATION,
  ORTHOGONAL_ANGLES,
} from './types'

export {
  normalizeDeg,
  canonicalizeAngle,
  anglesEqual,
} from './angle'

export { anglesForPolicy } from './policy'

export {
  searchFreeAngle,
  resolveFreeConfig,
  isBetterAngleEval,
  sampleCircle,
  expandAround,
  selectCoarseSeeds,
  unionPackedBoundsMm2,
} from './search'
export type { AngleEval, FreeAngleSearchResult } from './search'
