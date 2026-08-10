import type { GeometryPart } from '../../geometry'
import type { NestingSuccess, Placement } from '../../nesting'
import { applyPlacement } from '../../nesting/placement/worldGeometry'

export type ExportValidationIssue = {
  code:
    | 'no_result'
    | 'no_parts'
    | 'missing_part'
    | 'bad_sheet'
    | 'nan'
    | 'duplicate_placement'
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

  const byId = new Map(parts.map((p) => [p.id, p]))
  const seen = new Set<string>()

  for (const sheet of result.sheets) {
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
  }

  for (const pl of result.placements) {
    const key = `${pl.partId}@${pl.sheetIndex}:${pl.x},${pl.y},${pl.rotation}`
    if (seen.has(key)) {
      issues.push({
        code: 'duplicate_placement',
        message: `Duplicate placement for ${pl.partId}`,
      })
    }
    seen.add(key)

    if (
      !finite(pl.x) ||
      !finite(pl.y) ||
      !finite(pl.rotation) ||
      !finite(pl.sheetIndex)
    ) {
      issues.push({
        code: 'nan',
        message: `Non-finite transform for ${pl.partId}`,
      })
      continue
    }

    const part = byId.get(pl.partId)
    if (!part) {
      issues.push({
        code: 'missing_part',
        message: `Missing geometry for part ${pl.partId}`,
      })
      continue
    }

    const placed = applyPlacement(part, pl)
    if (!pointsOk(placed.outer) || placed.holes.some((h) => !pointsOk(h))) {
      issues.push({
        code: 'nan',
        message: `Non-finite geometry after transform for ${pl.partId}`,
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
