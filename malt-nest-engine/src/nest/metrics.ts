import { bboxArea, shapeArea } from '../geometry'
import type { BoundingBox } from '../geometry/types'
import type { NestMetrics, NestPlacement, NestSheetResult } from './types'

export function computeNestMetrics(
  sheets: readonly NestSheetResult[],
  placed: readonly NestPlacement[],
  unplacedCount: number,
): NestMetrics {
  const sheetCount = sheets.length
  const sheetArea = sheets.reduce(
    (s, sh) => s + sh.sheet.width * sh.sheet.height,
    0,
  )
  const usedPartArea = placed.reduce((s, p) => s + shapeArea(p.geometry), 0)
  const utilization = sheetArea > 0 ? usedPartArea / sheetArea : 0

  const sheetPackedBounds: (BoundingBox | null)[] = sheets.map((sh) =>
    unionBounds(sh.placements.map((p) => p.bounds)),
  )
  const packedBoundsMm2 = sheetPackedBounds.reduce(
    (s, b) => s + (b ? bboxArea(b) : 0),
    0,
  )

  return {
    sheetCount,
    placedCount: placed.length,
    unplacedCount,
    usedPartArea,
    sheetArea,
    utilization,
    waste: 1 - utilization,
    packedBoundsMm2,
    sheetPackedBounds,
  }
}

function unionBounds(boxes: readonly BoundingBox[]): BoundingBox | null {
  if (!boxes.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX
    if (b.minY < minY) minY = b.minY
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxY > maxY) maxY = b.maxY
  }
  return { minX, minY, maxX, maxY }
}

/** For tests — packed bounds of a single placement list. */
export function placementsPackedBounds(
  placements: readonly { bounds: BoundingBox }[],
): BoundingBox | null {
  return unionBounds(placements.map((p) => p.bounds))
}
