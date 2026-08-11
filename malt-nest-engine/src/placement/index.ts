export type {
  Sheet,
  UsableRegion,
  Placement,
  PlacementConfig,
  PlacementValidationResult,
  ValidationReason,
} from './types'
export { DEFAULT_PLACEMENT_CONFIG } from './types'

export {
  createSheet,
  usableRegion,
  usableWidth,
  usableHeight,
  pointInUsableRegion,
} from './sheet'

export { createPlacement, clonePlacement } from './transform'

export {
  boundsOverlap,
  collidePlacements,
  placementsCollide,
} from './collide'
export type { CollisionKind, CollisionResult, BBoxHit } from './collide'

export {
  isInsideSheet,
  validatePlacementOnSheet,
  validatePlacement,
} from './validate'
