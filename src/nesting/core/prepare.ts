import type { GeometryPart, Point } from '../../geometry'
import {
  boundingBox,
  partRotationOrigin,
  rotatePoints,
  solidFromRings,
  type Solid,
} from '../../geometry'
import type { NestingSettings } from '../types'
import { resolveAllowedAngles } from '../optimization/rotations'

export type PreparedVariant = {
  partId: string
  sourceIndex: number
  rotation: number
  /** Rotated local geometry (origin = rotation origin). */
  solid: Solid
  area: number
  rankSize: number
  width: number
  height: number
  perimeter: number
}

export type PreparedPart = {
  partId: string
  sourceIndex: number
  area: number
  variants: PreparedVariant[]
  /** Allowed values are cheap; rotated solids are built only when evaluated. */
  rotations: number[]
  maxWidth: number
  maxHeight: number
  perimeter: number
  widestRotation: number
  tallestRotation: number
  hasHoles: boolean
  /** Source rings for lazy free-angle variants (mm space). */
  sourceOuter: Point[]
  sourceHoles: Point[][]
}

export function resolveRotations(
  settings: NestingSettings,
  parts: GeometryPart[] = [],
): number[] {
  const angles = resolveAllowedAngles(settings, parts)
  return angles.length ? angles : [0]
}

function rotateSolidLocal(outer: Point[], holes: Point[][], deg: number): Solid {
  const origin = partRotationOrigin(outer)
  const ro = rotatePoints(outer, deg, origin)
  const rh = holes.map((h) => rotatePoints(h, deg, origin))
  return solidFromRings(ro, rh)
}

function ringPerimeter(points: Point[]): number {
  let p = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    p += Math.hypot(a.x - b.x, a.y - b.y)
  }
  return p
}

function buildVariant(
  partId: string,
  sourceIndex: number,
  area: number,
  outer: Point[],
  holes: Point[][],
  rot: number,
  perimeter = ringPerimeter(outer),
): PreparedVariant {
  const solid = rotateSolidLocal(outer, holes, rot)
  const b = solid.bounds
  return {
    partId,
    sourceIndex,
    rotation: rot,
    solid,
    area,
    rankSize: Math.max(b.width, b.height),
    width: b.width,
    height: b.height,
    perimeter,
  }
}

export function rotationDimensions(
  part: Pick<PreparedPart, 'sourceOuter'>,
  rotation: number,
): { width: number; height: number } {
  const radians = (rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of part.sourceOuter) {
    const x = point.x * cosine - point.y * sine
    const y = point.x * sine + point.y * cosine
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { width: maxX - minX, height: maxY - minY }
}

export function prepareParts(
  parts: GeometryPart[],
  settings: NestingSettings,
  opts: { sortByArea?: boolean } = { sortByArea: true },
): PreparedPart[] {
  const rotations = resolveRotations(settings, parts)
  const prepared: PreparedPart[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.outer.points.length < 2) continue
    const sourceOuter = part.outer.points
    const sourceHoles = part.holes.map((h) => h.points)
    const firstRotation = rotations[0] ?? 0
    const perimeter = ringPerimeter(sourceOuter)
    const variants = [
      buildVariant(
        part.id,
        i,
        part.area,
        sourceOuter,
        sourceHoles,
        firstRotation,
        perimeter,
      ),
    ]
    let maxWidth = 0
    let maxHeight = 0
    let widestRotation = firstRotation
    let tallestRotation = firstRotation
    const dimensionsPart = { sourceOuter }
    for (const rotation of rotations) {
      const dimensions = rotationDimensions(dimensionsPart, rotation)
      if (dimensions.width > maxWidth) {
        maxWidth = dimensions.width
        widestRotation = rotation
      }
      if (dimensions.height > maxHeight) {
        maxHeight = dimensions.height
        tallestRotation = rotation
      }
    }
    prepared.push({
      partId: part.id,
      sourceIndex: i,
      area: part.area,
      variants,
      rotations,
      maxWidth,
      maxHeight,
      perimeter,
      widestRotation,
      tallestRotation,
      hasHoles: part.holes.length > 0,
      sourceOuter,
      sourceHoles,
    })
  }

  if (opts.sortByArea !== false) {
    prepared.sort((a, b) => {
      if (b.area !== a.area) return b.area - a.area
      const as = Math.max(a.maxWidth, a.maxHeight)
      const bs = Math.max(b.maxWidth, b.maxHeight)
      if (bs !== as) return bs - as
      return a.partId.localeCompare(b.partId)
    })
  }

  return prepared
}

/** Get existing variant or build & cache a new rotation from source geometry. */
export function getOrCreateVariant(
  part: PreparedPart,
  rotation: number,
): PreparedVariant {
  const remainder = rotation % 360
  const rot = remainder < 0 ? remainder + 360 : remainder || 0
  const exact = part.variants.find((v) => Object.is(v.rotation, rot))
  if (exact) return exact
  const v = buildVariant(
    part.partId,
    part.sourceIndex,
    part.area,
    part.sourceOuter,
    part.sourceHoles,
    rot,
    part.perimeter,
  )
  part.variants.push(v)
  return v
}

/** Build a one-shot evaluation variant without retaining the rotated solid. */
export function createVariant(
  part: PreparedPart,
  rotation: number,
): PreparedVariant {
  const remainder = rotation % 360
  const rot = remainder < 0 ? remainder + 360 : remainder || 0
  const cached = part.variants.find((variant) => Object.is(variant.rotation, rot))
  return (
    cached ??
    buildVariant(
      part.partId,
      part.sourceIndex,
      part.area,
      part.sourceOuter,
      part.sourceHoles,
      rot,
      part.perimeter,
    )
  )
}

export function variantWorldSolid(
  variant: PreparedVariant,
  x: number,
  y: number,
): Solid {
  const o = variant.solid.outer.points.map((p) => ({ x: p.x + x, y: p.y + y }))
  const holes = variant.solid.holes.map((h) =>
    h.points.map((p) => ({ x: p.x + x, y: p.y + y })),
  )
  return solidFromRings(o, holes)
}

export function ifpBounds(
  variant: PreparedVariant,
  sheetW: number,
  sheetH: number,
  margin: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const b = variant.solid.bounds
  const minX = margin - b.minX
  const minY = margin - b.minY
  const maxX = sheetW - margin - b.maxX
  const maxY = sheetH - margin - b.maxY
  if (minX > maxX + 1e-9 || minY > maxY + 1e-9) return null
  return { minX, minY, maxX, maxY }
}

export function findVariant(
  part: PreparedPart,
  rotation: number,
): PreparedVariant | null {
  if (!part.variants.length) return null
  return getOrCreateVariant(part, rotation)
}

export { boundingBox }
