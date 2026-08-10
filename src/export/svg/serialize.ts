import type { GeometryPart, Point } from '../../geometry'
import type { NestingSuccess, Placement } from '../../nesting'
import { applyPlacement } from '../../nesting/placement/worldGeometry'
import { nestToSvgPoints } from './coords'
import { sheetFileName } from './filenames'
import { validateNestExport } from '../validation/validateExport'

export type ExportSvgOptions = {
  sourceFileName?: string | null
  /** Include sheet boundary rect (non-cut). Default true. */
  includeSheetBoundary?: boolean
  /** ISO timestamp override for tests. */
  timestamp?: string
}

export type ExportedSheetSvg = {
  sheetIndex: number
  fileName: string
  svg: string
  widthMm: number
  heightMm: number
  partCount: number
}

export type ExportSvgResult =
  | { ok: true; sheets: ExportedSheetSvg[] }
  | { ok: false; message: string; issues: string[] }

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function ringPath(points: Point[]): string {
  if (!points.length) return ''
  const [f, ...rest] = points
  let d = `M ${fmt(f!.x)} ${fmt(f!.y)}`
  for (const p of rest) d += ` L ${fmt(p.x)} ${fmt(p.y)}`
  d += ' Z'
  return d
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 1e6) / 1e6
  return String(r)
}

function compoundPath(outer: Point[], holes: Point[][]): string {
  let d = ringPath(outer)
  for (const h of holes) {
    const hd = ringPath(h)
    if (hd) d += ` ${hd}`
  }
  return d
}

function partLabel(index: number): string {
  return `part-${String(index + 1).padStart(3, '0')}`
}

function serializeSheet(
  result: NestingSuccess,
  parts: GeometryPart[],
  sheetIndex: number,
  options: ExportSvgOptions,
): ExportedSheetSvg {
  const sheet = result.sheets.find((s) => s.sheetIndex === sheetIndex)
  if (!sheet) {
    throw new Error(`Sheet ${sheetIndex} missing from NestingResult`)
  }
  const w = sheet.widthMm
  const h = sheet.heightMm
  const includeSheet = options.includeSheetBoundary !== false
  const ts = options.timestamp ?? new Date().toISOString()
  const placements = result.placements.filter((p) => p.sheetIndex === sheetIndex)
  const byId = new Map(parts.map((p) => [p.id, p]))

  const body: string[] = []
  body.push(`  <metadata>`)
  body.push(`    <maltnest xmlns="https://maltnest.local/ns">`)
  body.push(`      <generator>Malt Nest</generator>`)
  body.push(
    `      <source>${esc(options.sourceFileName ?? '')}</source>`,
  )
  body.push(`      <sheetIndex>${sheetIndex}</sheetIndex>`)
  body.push(`      <sheetWidthMm>${fmt(w)}</sheetWidthMm>`)
  body.push(`      <sheetHeightMm>${fmt(h)}</sheetHeightMm>`)
  body.push(`      <partCount>${placements.length}</partCount>`)
  body.push(`      <timestamp>${esc(ts)}</timestamp>`)
  body.push(`      <engineId>${esc(result.engineId)}</engineId>`)
  body.push(`    </maltnest>`)
  body.push(`  </metadata>`)

  if (includeSheet) {
    body.push(
      `  <g id="sheet" data-export-role="sheet-boundary" data-cut="false">`,
    )
    body.push(
      `    <rect x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" fill="none" stroke="#888888" stroke-width="0.5" />`,
    )
    body.push(`  </g>`)
  }

  body.push(`  <g id="parts" data-export-role="parts">`)
  placements.forEach((pl: Placement, i) => {
    const part = byId.get(pl.partId)
    if (!part) return
    const placed = applyPlacement(part, pl)
    const outer = nestToSvgPoints(placed.outer, h)
    const holes = placed.holes.map((hole) => nestToSvgPoints(hole, h))
    const d = compoundPath(outer, holes)
    const id = partLabel(i)
    body.push(
      `    <g id="${id}" data-part-id="${esc(pl.partId)}" data-rotation="${fmt(pl.rotation)}" data-x="${fmt(pl.x)}" data-y="${fmt(pl.y)}">`,
    )
    body.push(
      `      <path d="${d}" fill="none" stroke="#000000" stroke-width="0.25" fill-rule="evenodd" />`,
    )
    body.push(`    </g>`)
  })
  body.push(`  </g>`)

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}">`,
    ...body,
    `</svg>`,
    ``,
  ].join('\n')

  return {
    sheetIndex,
    fileName: sheetFileName(options.sourceFileName, sheetIndex),
    svg,
    widthMm: w,
    heightMm: h,
    partCount: placements.length,
  }
}

/**
 * Build production SVG document(s) from NestingResult.
 * Geometry is taken from NestingResult placements — not re-nested.
 */
export function exportNestingToSvg(
  result: NestingSuccess,
  parts: GeometryPart[],
  options: ExportSvgOptions = {},
): ExportSvgResult {
  const validation = validateNestExport(result, parts)
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.issues[0]?.message ?? 'Export validation failed',
      issues: validation.issues.map((i) => i.message),
    }
  }

  try {
    const sheets = result.sheets.map((s) =>
      serializeSheet(result, parts, s.sheetIndex, options),
    )
    return { ok: true, sheets }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'SVG export failed',
      issues: [err instanceof Error ? err.message : 'SVG export failed'],
    }
  }
}

/** Export a single sheet index. */
export function exportNestingSheetToSvg(
  result: NestingSuccess,
  parts: GeometryPart[],
  sheetIndex: number,
  options: ExportSvgOptions = {},
): ExportSvgResult {
  const full = exportNestingToSvg(result, parts, options)
  if (!full.ok) return full
  const sheet = full.sheets.find((s) => s.sheetIndex === sheetIndex)
  if (!sheet) {
    return {
      ok: false,
      message: `Sheet ${sheetIndex} not found`,
      issues: [`Sheet ${sheetIndex} not found`],
    }
  }
  return { ok: true, sheets: [sheet] }
}
