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
  hasHoles: boolean
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
    const variants: PreparedVariant[] = []
    for (const rot of rotations) {
      const solid = rotateSolidLocal(
        part.outer.points,
        part.holes.map((h) => h.points),
        rot,
      )
      const b = solid.bounds
      variants.push({
        partId: part.id,
        sourceIndex: i,
        rotation: rot,
        solid,
        area: part.area,
        rankSize: Math.max(b.width, b.height),
        width: b.width,
        height: b.height,
        perimeter: ringPerimeter(solid.outer.points),
      })
    }
    prepared.push({
      partId: part.id,
      sourceIndex: i,
      area: part.area,
      variants,
      hasHoles: part.holes.length > 0,
    })
  }

  if (opts.sortByArea !== false) {
    prepared.sort((a, b) => {
      if (b.area !== a.area) return b.area - a.area
      const as = Math.max(...a.variants.map((v) => v.rankSize))
      const bs = Math.max(...b.variants.map((v) => v.rankSize))
      if (bs !== as) return bs - as
      return a.partId.localeCompare(b.partId)
    })
  }

  return prepared
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
  const exact = part.variants.find((v) => Math.abs(v.rotation - rotation) < 1e-6)
  if (exact) return exact
  let best: PreparedVariant | null = part.variants[0] ?? null
  let bestD = Infinity
  for (const v of part.variants) {
    const d = Math.min(
      Math.abs(v.rotation - rotation),
      360 - Math.abs(v.rotation - rotation),
    )
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  return best
}

export { boundingBox }
