import {
  solidFromRings,
  solidsCollide,
  type GeometryPart,
  type Solid,
} from '../../geometry'
import type { NestingSuccess, Placement } from '../../nesting'
import { validateGeometryPart } from '../../nesting/core/validate'
import { applyPlacement } from '../../nesting/placement/worldGeometry'

export type ExportValidationIssue = {
  code:
    | 'no_result'
    | 'no_parts'
    | 'missing_part'
    | 'invalid_part_id'
    | 'duplicate_part'
    | 'bad_sheet'
    | 'nan'
    | 'duplicate_placement'
    | 'out_of_bounds'
    | 'invalid_geometry'
    | 'overlap'
    | 'spacing_violation'
    | 'margin_violation'
    | 'inconsistent_counts'
  message: string
}

export type ExportValidation = {
  ok: boolean
  issues: ExportValidationIssue[]
}

function finite(n: number): boolean {
  return Number.isFinite(n)
}

function pointsOk(pts: { x: number; y: number }[]): boolean {
  return pts.every((p) => finite(p.x) && finite(p.y))
}

/** Validate NestingResult + parts before generating SVG. */
export function validateNestExport(
  result: NestingSuccess,
  parts: GeometryPart[],
): ExportValidation {
  const issues: ExportValidationIssue[] = []
  if (!result || result.status !== 'ok') {
    return {
      ok: false,
      issues: [{ code: 'no_result', message: 'No successful nesting result' }],
    }
  }
  if (!parts.length) {
    issues.push({ code: 'no_parts', message: 'No geometry parts available' })
  }

  const byId = new Map<string, GeometryPart>()
  const validGeometryIds = new Set<string>()
  for (const part of parts) {
    if (!part.id.trim()) {
      issues.push({
        code: 'invalid_part_id',
        message: 'Source part IDs must be non-empty',
      })
      continue
    }
    if (byId.has(part.id)) {
      issues.push({
        code: 'duplicate_part',
        message: `Duplicate source part ID ${part.id}`,
      })
      continue
    }
    byId.set(part.id, part)
    try {
      validateGeometryPart(part)
      validGeometryIds.add(part.id)
    } catch {
      issues.push({
        code: 'invalid_geometry',
        message: `Invalid source geometry for part ${part.id}`,
      })
    }
  }
  const seenParts = new Set<string>()
  const sheetByIndex = new Map<number, NestingSuccess['sheets'][number]>()
  const placementCountBySheet = new Map<number, number>()
  const solidsBySheet = new Map<
    number,
    Array<{ partId: string; solid: Solid }>
  >()
  for (const placement of result.placements) {
    placementCountBySheet.set(
      placement.sheetIndex,
      (placementCountBySheet.get(placement.sheetIndex) ?? 0) + 1,
    )
  }

  for (const sheet of result.sheets) {
    if (
      !finite(sheet.sheetIndex) ||
      !Number.isInteger(sheet.sheetIndex) ||
      sheet.sheetIndex < 0
    ) {
      issues.push({
        code: 'bad_sheet',
        message: `Invalid sheet index ${sheet.sheetIndex}`,
      })
    } else if (sheetByIndex.has(sheet.sheetIndex)) {
      issues.push({
        code: 'bad_sheet',
        message: `Duplicate sheet index ${sheet.sheetIndex}`,
      })
    } else {
      sheetByIndex.set(sheet.sheetIndex, sheet)
    }
    if (
      !finite(sheet.widthMm) ||
      !finite(sheet.heightMm) ||
      sheet.widthMm <= 0 ||
      sheet.heightMm <= 0
    ) {
      issues.push({
        code: 'bad_sheet',
        message: `Invalid sheet ${sheet.sheetIndex} dimensions`,
      })
    }
    if (sheet.marginMm != null && (!finite(sheet.marginMm) || sheet.marginMm < 0)) {
      issues.push({
        code: 'bad_sheet',
        message: `Invalid margin for sheet ${sheet.sheetIndex}`,
      })
    }

    const actualCount = placementCountBySheet.get(sheet.sheetIndex) ?? 0
    if (
      !Number.isInteger(sheet.placedCount) ||
      sheet.placedCount < 0 ||
      sheet.placedCount !== actualCount
    ) {
      issues.push({
        code: 'inconsistent_counts',
        message: `Sheet ${sheet.sheetIndex} placement count does not match placements`,
      })
    }
  }

  for (const pl of result.placements) {
    if (seenParts.has(pl.partId)) {
      issues.push({
        code: 'duplicate_placement',
        message: `Duplicate placement for ${pl.partId}`,
      })
    }
    seenParts.add(pl.partId)

    if (!finite(pl.x) || !finite(pl.y) || !finite(pl.rotation)) {
      issues.push({
        code: 'nan',
        message: `Non-finite transform for ${pl.partId}`,
      })
      continue
    }
    if (
      !finite(pl.sheetIndex) ||
      !Number.isInteger(pl.sheetIndex) ||
      pl.sheetIndex < 0
    ) {
      issues.push({
        code: 'bad_sheet',
        message: `Invalid sheet index for ${pl.partId}`,
      })
      continue
    }

    const sheet = sheetByIndex.get(pl.sheetIndex)
    if (!sheet) {
      issues.push({
        code: 'bad_sheet',
        message: `Unknown sheet ${pl.sheetIndex} for ${pl.partId}`,
      })
    }

    const part = byId.get(pl.partId)
    if (!part) {
      issues.push({
        code: 'missing_part',
        message: `Missing geometry for part ${pl.partId}`,
      })
      continue
    }

    let placed: ReturnType<typeof applyPlacement>
    try {
      placed = applyPlacement(part, pl)
    } catch {
      issues.push({
        code: 'nan',
        message: `Invalid geometry for ${pl.partId}`,
      })
      continue
    }
    const points = [...placed.outer, ...placed.holes.flat()]
    if (!pointsOk(points)) {
      issues.push({
        code: 'nan',
        message: `Non-finite geometry after transform for ${pl.partId}`,
      })
      continue
    }
    if (
      sheet &&
      points.some(
        (point) =>
          point.x < (sheet.marginMm ?? 0) - 1e-6 ||
          point.y < (sheet.marginMm ?? 0) - 1e-6 ||
          point.x > sheet.widthMm - (sheet.marginMm ?? 0) + 1e-6 ||
          point.y > sheet.heightMm - (sheet.marginMm ?? 0) + 1e-6,
      )
    ) {
      issues.push({
        code: sheet.marginMm ? 'margin_violation' : 'out_of_bounds',
        message: sheet.marginMm
          ? `Placement for ${pl.partId} violates sheet ${pl.sheetIndex} margin`
          : `Placement for ${pl.partId} is outside sheet ${pl.sheetIndex}`,
      })
    }

    if (sheet && validGeometryIds.has(pl.partId)) {
      const solid = solidFromRings(placed.outer, placed.holes)
      const prior = solidsBySheet.get(pl.sheetIndex) ?? []
      const spacingMm = Math.max(0, result.spacingMm ?? 0)
      const collision = prior.find((entry) =>
        solidsCollide(entry.solid, solid, spacingMm),
      )
      if (collision) {
        issues.push({
          code: spacingMm > 0 ? 'spacing_violation' : 'overlap',
          message:
            spacingMm > 0
              ? `Placements ${collision.partId} and ${pl.partId} violate spacing on sheet ${pl.sheetIndex}`
              : `Placements ${collision.partId} and ${pl.partId} overlap on sheet ${pl.sheetIndex}`,
        })
      }
      prior.push({ partId: pl.partId, solid })
      solidsBySheet.set(pl.sheetIndex, prior)
    }
  }

  const { statistics } = result
  if (statistics.partCount !== parts.length) {
    issues.push({
      code: 'inconsistent_counts',
      message: 'Result part count does not match source geometry',
    })
  }
  if (statistics.placedCount !== result.placements.length) {
    issues.push({
      code: 'inconsistent_counts',
      message: 'Result placed count does not match placements',
    })
  }
  if (statistics.unplacedCount !== result.unplacedPartIds.length) {
    issues.push({
      code: 'inconsistent_counts',
      message: 'Result unplaced count does not match unplaced IDs',
    })
  }
  if (statistics.placedCount + statistics.unplacedCount !== statistics.partCount) {
    issues.push({
      code: 'inconsistent_counts',
      message: 'Placed and unplaced counts do not add up to the part count',
    })
  }
  if (statistics.sheetCountUsed !== result.sheets.length) {
    issues.push({
      code: 'inconsistent_counts',
      message: 'Result sheet count does not match sheet records',
    })
  }

  const unplacedIds = new Set<string>()
  for (const id of result.unplacedPartIds) {
    if (!id.trim() || !byId.has(id)) {
      issues.push({
        code: 'missing_part',
        message: `Unknown unplaced part ${id}`,
      })
    }
    if (unplacedIds.has(id)) {
      issues.push({
        code: 'inconsistent_counts',
        message: `Duplicate unplaced part ${id}`,
      })
    }
    if (seenParts.has(id)) {
      issues.push({
        code: 'inconsistent_counts',
        message: `Part ${id} is both placed and unplaced`,
      })
    }
    unplacedIds.add(id)
  }
  for (const id of byId.keys()) {
    if (!seenParts.has(id) && !unplacedIds.has(id)) {
      issues.push({
        code: 'inconsistent_counts',
        message: `Part ${id} is absent from placed and unplaced results`,
      })
    }
  }

  return { ok: issues.length === 0, issues }
}

export type ConsistencyReport = {
  ok: boolean
  partCount: number
  placementCount: number
  sheetCount: number
  partIds: string[]
  placements: Array<{
    partId: string
    sheetIndex: number
    x: number
    y: number
    rotation: number
    bbox: { minX: number; minY: number; maxX: number; maxY: number }
  }>
  issues: string[]
}

/** Compare NestingResult metadata against what export would serialize. */
export function verifyExportConsistency(
  result: NestingSuccess,
  parts: GeometryPart[],
): ConsistencyReport {
  const issues: string[] = []
  const byId = new Map(parts.map((p) => [p.id, p]))
  const placements: ConsistencyReport['placements'] = []

  for (const pl of result.placements) {
    const part = byId.get(pl.partId)
    if (!part) {
      issues.push(`missing part ${pl.partId}`)
      continue
    }
    const { outer } = applyPlacement(part, pl)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of outer) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    placements.push({
      partId: pl.partId,
      sheetIndex: pl.sheetIndex,
      x: pl.x,
      y: pl.y,
      rotation: pl.rotation,
      bbox: { minX, minY, maxX, maxY },
    })
  }

  if (result.placements.length !== placements.length) {
    issues.push('placement count mismatch after resolution')
  }

  return {
    ok: issues.length === 0,
    partCount: parts.length,
    placementCount: result.placements.length,
    sheetCount: result.sheets.length,
    partIds: [...new Set(result.placements.map((p: Placement) => p.partId))],
    placements,
    issues,
  }
}
