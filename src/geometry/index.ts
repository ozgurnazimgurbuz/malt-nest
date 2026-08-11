export type {
  BoundingBox,
  Bounds,
  Contour,
  GeometryPart,
  MultiPolygon,
  Part,
  PartId,
  Point,
  Polygon,
  Segment,
  Transform2D,
} from './types'
export {
  boundingBox,
  centroid,
  cleanClosedRing,
  cleanPolyline,
  nearlyEqual,
  netArea,
  normalizeWinding,
  pointInPolygon,
  pointsEqual,
  polygonArea,
  signedArea,
  toPolygon,
  unionBounds,
} from './ops'
export {
  boundsOverlap,
  expandBounds,
  pointInSolid,
  segmentsIntersect,
  segmentsProperlyIntersect,
  solidFromRings,
  solidInsideRect,
  solidsCollideByDistance,
  solidsDistance,
  solidsOverlap,
  translateSolid,
  type Solid,
} from './collide'
export { solidsCollide } from './spacingCollide'
export {
  partRotationOrigin,
  rotatePoint,
  rotatePoints,
  transformPolygon,
  translatePoint,
  translatePoints,
} from './transform'
export {
  configureGeometryTolerance,
  geomEps,
  GeometryError,
  nearlyEqualNum,
  nearlyZero,
  type GeometryIssue,
  type GeometryTolerance,
} from './tolerance'
export { normalizePolygon, validateGeometry } from './normalize'
export { offsetPolygon, offsetPolygonComponents, offsetSolid } from './offset'
export {
  union,
  difference,
  intersection,
  xor,
  booleanHasArea,
  type BooleanResult,
} from './boolean'
export {
  computeNfp,
  nfpAsSolid,
  nfpBoundaryTranslations,
  nfpBounds,
  translationInNfp,
  GEOMETRY_BACKEND_ID,
  type NfpResult,
  type NfpOptions,
} from './nfp'
export {
  computeIfp,
  holeAsContainer,
  polygonContainsPolygon,
  solidInsideHole,
  solidInsideSheet,
} from './containment'
export {
  beginNestingGeometrySession,
  clearSharedNfpCache,
  getSharedNfpCache,
  NfpCache,
  type NfpCacheKey,
} from './cache'
export {
  canFitInHole,
  candidateHolesForPart,
  findPartInPartPlacement,
  findPartInPartPlacements,
  type HoleFitResult,
} from './partInPart'
export {
  classifySeparation,
  distance,
  respectsSpacing,
  type SeparationKind,
} from './distance'
export { convexDecompose, isConvexPolygon } from './convex'
export { convexHull, minkowskiDifferenceConvex, minkowskiSumConvex } from './minkowski'
