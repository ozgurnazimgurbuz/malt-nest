import {
  boundingBox,
  cleanClosedRing,
  centroid,
  netArea,
  pointInPolygon,
  segmentsIntersect,
  signedArea,
  validateGeometry,
  type GeometryPart,
} from '../../geometry'
import type { NestingRequest } from '../types'

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`)
}

function matchesGeometry(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected))
}

function ringSelfIntersects(points: GeometryPart['outer']['points']): boolean {
  const ring = cleanClosedRing(points)
  const count = ring.length
  for (let i = 0; i < count; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % count]!
    for (let j = i + 1; j < count; j++) {
      if (j === i || j === (i + 1) % count || (j + 1) % count === i) continue
      const c = ring[j]!
      const d = ring[(j + 1) % count]!
      if (segmentsIntersect(a, b, c, d)) return true
    }
  }
  return false
}

function ringsIntersect(
  aPoints: GeometryPart['outer']['points'],
  bPoints: GeometryPart['outer']['points'],
): boolean {
  const a = cleanClosedRing(aPoints)
  const b = cleanClosedRing(bPoints)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (
        segmentsIntersect(
          a[i]!,
          a[(i + 1) % a.length]!,
          b[j]!,
          b[(j + 1) % b.length]!,
        )
      ) {
        return true
      }
    }
  }
  return false
}

export function validateGeometryPart(part: GeometryPart): void {
  if (!part.id.trim()) throw new TypeError('Part IDs must be non-empty')

  if (validateGeometry(part.outer.points).length > 0) {
    throw new TypeError(`Part ${part.id} has invalid outer geometry`)
  }
  for (const hole of part.holes) {
    if (validateGeometry(hole.points).length > 0) {
      throw new TypeError(`Part ${part.id} has invalid hole geometry`)
    }
  }
  if (ringSelfIntersects(part.outer.points)) {
    throw new TypeError(`Part ${part.id} outer ring is self-intersecting`)
  }
  if (signedArea(part.outer.points) <= 0) {
    throw new TypeError(`Part ${part.id} outer ring must be counter-clockwise`)
  }
  for (let i = 0; i < part.holes.length; i++) {
    const hole = part.holes[i]!
    if (ringSelfIntersects(hole.points)) {
      throw new TypeError(`Part ${part.id} hole ${i} is self-intersecting`)
    }
    if (signedArea(hole.points) >= 0) {
      throw new TypeError(`Part ${part.id} hole ${i} must be clockwise`)
    }
    if (
      ringsIntersect(part.outer.points, hole.points) ||
      !pointInPolygon(hole.points[0]!, part.outer.points)
    ) {
      throw new TypeError(
        `Part ${part.id} hole ${i} must be strictly inside its outer ring`,
      )
    }
    for (let j = 0; j < i; j++) {
      const other = part.holes[j]!
      if (
        ringsIntersect(other.points, hole.points) ||
        pointInPolygon(hole.points[0]!, other.points) ||
        pointInPolygon(other.points[0]!, hole.points)
      ) {
        throw new TypeError(`Part ${part.id} holes ${j} and ${i} overlap`)
      }
    }
  }
  if (!Number.isFinite(part.area) || part.area <= 0) {
    throw new RangeError(`Part ${part.id} geometry area must be finite and positive`)
  }
  finite(part.centroid.x, `Part ${part.id} centroid x`)
  finite(part.centroid.y, `Part ${part.id} centroid y`)
  finite(part.boundingBox.minX, `Part ${part.id} bounds minX`)
  finite(part.boundingBox.minY, `Part ${part.id} bounds minY`)
  finite(part.boundingBox.maxX, `Part ${part.id} bounds maxX`)
  finite(part.boundingBox.maxY, `Part ${part.id} bounds maxY`)
  finite(part.boundingBox.width, `Part ${part.id} bounds width`)
  finite(part.boundingBox.height, `Part ${part.id} bounds height`)
  if (
    part.boundingBox.width <= 0 ||
    part.boundingBox.height <= 0 ||
    part.boundingBox.minX > part.boundingBox.maxX ||
    part.boundingBox.minY > part.boundingBox.maxY
  ) {
    throw new RangeError(`Part ${part.id} geometry bounds must be positive`)
  }

  const actualArea = netArea(part.outer, part.holes)
  const actualBounds = boundingBox(part.outer.points)
  const actualCentroid = centroid(part.outer.points)
  if (!matchesGeometry(part.area, actualArea)) {
    throw new RangeError(`Part ${part.id} area does not match its geometry`)
  }
  const boundsMatch = (
    ['minX', 'minY', 'maxX', 'maxY', 'width', 'height'] as const
  ).every((key) => matchesGeometry(part.boundingBox[key], actualBounds[key]))
  if (!boundsMatch) {
    throw new RangeError(`Part ${part.id} bounding box does not match its geometry`)
  }
  if (
    !matchesGeometry(part.centroid.x, actualCentroid.x) ||
    !matchesGeometry(part.centroid.y, actualCentroid.y)
  ) {
    throw new RangeError(`Part ${part.id} centroid does not match its geometry`)
  }
}

/** Validate a direct engine request before any geometry or stock expansion. */
export function validateNestingRequest(request: NestingRequest): void {
  const ids = new Set<string>()
  for (const part of request.parts) {
    validateGeometryPart(part)
    if (ids.has(part.id)) throw new TypeError('Part IDs must be unique')
    ids.add(part.id)
  }

  for (let i = 0; i < request.sheets.length; i++) {
    const sheet = request.sheets[i]!
    finite(sheet.widthMm, `Sheet ${i} width`)
    finite(sheet.heightMm, `Sheet ${i} height`)
    finite(sheet.marginMm, `Sheet ${i} margin`)
    if (sheet.widthMm <= 0 || sheet.heightMm <= 0) {
      throw new RangeError(`Sheet ${i} width and height must be positive`)
    }
    if (sheet.marginMm < 0) {
      throw new RangeError(`Sheet ${i} margin must be nonnegative`)
    }
    if (
      sheet.marginMm * 2 >= sheet.widthMm ||
      sheet.marginMm * 2 >= sheet.heightMm
    ) {
      throw new RangeError(`Sheet ${i} margin must leave a positive usable area`)
    }
    if (!Number.isSafeInteger(sheet.quantity) || sheet.quantity <= 0) {
      throw new RangeError(`Sheet ${i} quantity must be a positive safe integer`)
    }
  }

  finite(request.settings.spacingMm, 'Part spacing')
  if (request.settings.spacingMm < 0) {
    throw new RangeError('Part spacing must be nonnegative')
  }
  if (request.settings.seed != null) {
    finite(request.settings.seed, 'Nesting seed')
  }
  if (
    request.settings.rotationMode != null &&
    !['orthogonal', 'balanced', 'deep', 'free'].includes(
      request.settings.rotationMode,
    )
  ) {
    throw new RangeError('Invalid rotation mode')
  }
  if (
    request.settings.allowedRotations.some((angle) => !Number.isFinite(angle)) ||
    request.settings.allowedRotationsExplicit?.some(
      (angle) => !Number.isFinite(angle),
    )
  ) {
    throw new RangeError('Rotation angles must be finite')
  }
  if (
    request.settings.rotationStepDeg != null &&
    (!Number.isFinite(request.settings.rotationStepDeg) ||
      request.settings.rotationStepDeg < 0.01)
  ) {
    throw new RangeError('Rotation step must be finite and at least 0.01 degrees')
  }
}
