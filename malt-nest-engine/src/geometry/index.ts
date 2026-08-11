export type {
  Point,
  Segment,
  Ring,
  Polygon,
  Shape,
  BoundingBox,
} from './types'
export { point, bboxWidth, bboxHeight, bboxArea } from './types'

export type { GeometryTolerance } from './tolerance'
export {
  DEFAULT_TOLERANCE,
  clipperPrecision,
  nearlyEqual,
  nearlyZero,
} from './tolerance'

export {
  signedArea,
  absoluteArea,
  perimeter,
  ringCentroid,
  ringBounds,
  isCcw,
  reverseRing,
  cleanRing,
  ensureWinding,
} from './ring'

export {
  makePolygon,
  makeShape,
  normalizePolygon,
  normalizeShape,
  polygonArea,
  polygonPerimeter,
  polygonCentroid,
  polygonBounds,
  shapeArea,
  shapePerimeter,
  shapeCentroid,
  shapeBounds,
} from './shape'

export {
  translateShape,
  rotateShape,
  rotateShapeAround,
  scaleShape,
  translateRing,
  rotateRing,
} from './ops/transform'

export {
  validateRing,
  validatePolygon,
  validateShape,
  isValidShape,
} from './ops/validity'

export {
  pointInRing,
  pointInPolygon,
  pointInShape,
  pointOnSegment,
  shapesNearlyEqual,
} from './ops/pointInPolygon'

export {
  polygonsIntersect,
  shapesIntersect,
  polygonContainsPolygon,
  shapeContainsPoint,
} from './ops/relate'

export { parseSvg } from './svg/parse'
export type { SvgParseOptions, SvgParseResult } from './svg/parse'
export { pathToRings } from './svg/path'

export {
  getGeometryBackend,
  setGeometryBackend,
  createClipper2Backend,
  roundTripScaled,
} from './backend'
export type { GeometryBackend } from './backend'
