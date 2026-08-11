import { isValidShape } from '../geometry'
import {
  DEFAULT_TOLERANCE,
  type GeometryTolerance,
} from '../geometry/tolerance'
import { collidePlacements } from './collide'
import { pointInUsableRegion, usableRegion } from './sheet'
import type {
  Placement,
  PlacementConfig,
  PlacementValidationResult,
  Sheet,
  ValidationReason,
} from './types'
import { DEFAULT_PLACEMENT_CONFIG } from './types'

/** True if placed solid lies in usable sheet region (vertices ⊆ usable rect). */
export function isInsideSheet(
  placement: Placement,
  sheet: Sheet,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): boolean {
  const region = usableRegion(sheet)
  // Broad reject
  const b = placement.bounds
  if (
    b.minX < region.minX - tol.abs ||
    b.minY < region.minY - tol.abs ||
    b.maxX > region.maxX + tol.abs ||
    b.maxY > region.maxY + tol.abs
  ) {
    // Still check vertices — bounds might be tight; if any vertex out → false
    return allOuterVerticesInside(placement, region, tol)
  }
  return allOuterVerticesInside(placement, region, tol)
}

function allOuterVerticesInside(
  placement: Placement,
  region: ReturnType<typeof usableRegion>,
  tol: GeometryTolerance,
): boolean {
  for (const poly of placement.geometry.polygons) {
    for (const p of poly.outer) {
      if (!pointInUsableRegion(p, region, tol)) return false
    }
  }
  return true
}

export function validatePlacementOnSheet(
  placement: Placement,
  sheet: Sheet,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): PlacementValidationResult {
  if (!isValidShape(placement.geometry, tol)) {
    return { valid: false, reason: 'invalid-geometry' }
  }
  if (!isInsideSheet(placement, sheet, tol)) {
    return { valid: false, reason: 'outside-sheet' }
  }
  return { valid: true, reason: 'ok' }
}

/**
 * Validate placement against sheet + optional already-accepted placements.
 * Gap comes from config (manufacturing clearance), not from geometry.
 */
export function validatePlacement(
  placement: Placement,
  sheet: Sheet,
  others: readonly Placement[] = [],
  config: PlacementConfig = DEFAULT_PLACEMENT_CONFIG,
): PlacementValidationResult {
  const tol = config.tolerance ?? DEFAULT_TOLERANCE
  if (!isValidShape(placement.geometry, tol)) {
    return { valid: false, reason: 'invalid-geometry' }
  }
  return validateKnownValidPlacement(placement, sheet, others, config)
}

/** Internal fast path after a rigidly transformed geometry was validated once. */
export function validateKnownValidPlacement(
  placement: Placement,
  sheet: Sheet,
  others: readonly Placement[] = [],
  config: PlacementConfig = DEFAULT_PLACEMENT_CONFIG,
): PlacementValidationResult {
  const tol = config.tolerance ?? DEFAULT_TOLERANCE
  if (!isInsideSheet(placement, sheet, tol)) {
    return { valid: false, reason: 'outside-sheet' }
  }

  const gap = Math.max(0, config.gap)
  for (const other of others) {
    const hit = collidePlacements(placement, other, gap, tol)
    if (hit.kind === 'overlap') {
      return {
        valid: false,
        reason: 'collision',
        detail: `overlapArea=${hit.overlapArea}`,
      }
    }
    if (hit.kind === 'gap-violation') {
      return {
        valid: false,
        reason: 'gap-violation',
        detail: `gap=${gap}`,
      }
    }
  }
  return { valid: true, reason: 'ok' }
}

export function reasonCode(r: PlacementValidationResult): ValidationReason {
  return r.reason
}
