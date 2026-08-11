import type { Point } from '../geometry'
import { cleanPolyline } from '../geometry'
import { flattenArc, flattenCubic, flattenQuadratic } from './curves'
import type { ParserWarning } from './warnings'

export type Subpath = {
  points: Point[]
  closed: boolean
}

type Cmd = { code: string; args: number[] }

function tokenizePath(d: string): Cmd[] | null {
  const cmds: Cmd[] = []
  const re =
    /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g
  let current: Cmd | null = null
  let match: RegExpExecArray | null
  let cursor = 0
  while ((match = re.exec(d)) !== null) {
    if (!/^[\s,]*$/.test(d.slice(cursor, match.index))) return null
    if (match[1]) {
      if (current) cmds.push(current)
      current = { code: match[1], args: [] }
    } else if (match[2]) {
      if (!current) return null
      const value = Number(match[2])
      if (!Number.isFinite(value)) return null
      current.args.push(value)
    }
    cursor = re.lastIndex
  }
  if (!/^[\s,]*$/.test(d.slice(cursor))) return null
  if (current) cmds.push(current)
  return cmds
}

function argCounts(code: string): number {
  switch (code.toUpperCase()) {
    case 'Z':
      return 0
    case 'H':
    case 'V':
      return 1
    case 'M':
    case 'L':
    case 'T':
      return 2
    case 'S':
    case 'Q':
      return 4
    case 'C':
      return 6
    case 'A':
      return 7
    default:
      return -1
  }
}

/**
 * Flatten SVG path `d` into subpaths of polyline points (user units).
 */
export function flattenPathData(
  d: string,
  tolerance: number,
  warnings: ParserWarning[],
  element?: string,
): Subpath[] {
  const cmds = tokenizePath(d)
  const malformed =
    !cmds ||
    cmds.length === 0 ||
    cmds[0]!.code.toUpperCase() !== 'M' ||
    cmds.some((cmd) => {
      const need = argCounts(cmd.code)
      if (need < 0) return true
      if (need === 0) return cmd.args.length !== 0
      if (cmd.args.length < need || cmd.args.length % need !== 0) return true
      if (cmd.code.toUpperCase() !== 'A') return false
      for (let i = 0; i < cmd.args.length; i += need) {
        if (
          (cmd.args[i + 3] !== 0 && cmd.args[i + 3] !== 1) ||
          (cmd.args[i + 4] !== 0 && cmd.args[i + 4] !== 1)
        ) {
          return true
        }
      }
      return false
    })
  if (malformed) {
    warnings.push({
      code: 'malformed_path',
      message: 'Malformed or unreadable path data',
      element,
    })
    return []
  }

  const subpaths: Subpath[] = []
  let points: Point[] = []
  let closed = false
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0
  let prevCode = ''
  let prevCtrl: Point | null = null

  const commit = () => {
    const cleaned = cleanPolyline(points)
    if (cleaned.length >= 2) {
      subpaths.push({ points: cleaned, closed })
    } else if (cleaned.length > 0) {
      warnings.push({
        code: 'empty_geometry',
        message: 'Path subpath has insufficient points',
        element,
      })
    }
    points = []
    closed = false
  }

  for (const cmd of cmds) {
    let code = cmd.code
    const abs = code === code.toUpperCase()
    code = code.toUpperCase()
    const need = argCounts(code)
    if (need < 0) {
      warnings.push({
        code: 'malformed_path',
        message: `Unknown path command: ${cmd.code}`,
        element,
      })
      continue
    }

    const args = cmd.args
    if (need === 0) {
      if (code === 'Z') {
        if (points.length > 0) {
          points.push({ x: startX, y: startY })
          closed = true
          cx = startX
          cy = startY
        }
        commit()
        prevCtrl = null
        prevCode = 'Z'
      }
      continue
    }

    if (args.length < need || args.length % need !== 0) {
      // Allow trailing incomplete groups to warn once
      if (args.length < need) {
        warnings.push({
          code: 'malformed_path',
          message: `Path command ${cmd.code} expected multiples of ${need} numbers`,
          element,
        })
        continue
      }
    }

    for (let i = 0; i + need - 1 < args.length; i += need) {
      const a = args.slice(i, i + need)

      if (code === 'M') {
        if (points.length) commit()
        const x = abs ? a[0]! : cx + a[0]!
        const y = abs ? a[1]! : cy + a[1]!
        cx = x
        cy = y
        startX = x
        startY = y
        points = [{ x, y }]
        // Subsequent pairs are implicit LineTos
        code = 'L'
        prevCtrl = null
        prevCode = 'M'
        continue
      }

      if (points.length === 0) {
        points.push({ x: cx, y: cy })
        startX = cx
        startY = cy
      }

      if (code === 'L') {
        const x = abs ? a[0]! : cx + a[0]!
        const y = abs ? a[1]! : cy + a[1]!
        cx = x
        cy = y
        points.push({ x, y })
        prevCtrl = null
      } else if (code === 'H') {
        const x = abs ? a[0]! : cx + a[0]!
        cx = x
        points.push({ x, y: cy })
        prevCtrl = null
      } else if (code === 'V') {
        const y = abs ? a[0]! : cy + a[0]!
        cy = y
        points.push({ x: cx, y })
        prevCtrl = null
      } else if (code === 'C') {
        const x1 = abs ? a[0]! : cx + a[0]!
        const y1 = abs ? a[1]! : cy + a[1]!
        const x2 = abs ? a[2]! : cx + a[2]!
        const y2 = abs ? a[3]! : cy + a[3]!
        const x = abs ? a[4]! : cx + a[4]!
        const y = abs ? a[5]! : cy + a[5]!
        const p0 = { x: cx, y: cy }
        flattenCubic(p0, { x: x1, y: y1 }, { x: x2, y: y2 }, { x, y }, tolerance, points)
        cx = x
        cy = y
        prevCtrl = { x: x2, y: y2 }
      } else if (code === 'S') {
        const x2 = abs ? a[0]! : cx + a[0]!
        const y2 = abs ? a[1]! : cy + a[1]!
        const x = abs ? a[2]! : cx + a[2]!
        const y = abs ? a[3]! : cy + a[3]!
        let x1 = cx
        let y1 = cy
        if (prevCode === 'C' || prevCode === 'S') {
          x1 = 2 * cx - (prevCtrl?.x ?? cx)
          y1 = 2 * cy - (prevCtrl?.y ?? cy)
        }
        const p0 = { x: cx, y: cy }
        flattenCubic(p0, { x: x1, y: y1 }, { x: x2, y: y2 }, { x, y }, tolerance, points)
        cx = x
        cy = y
        prevCtrl = { x: x2, y: y2 }
      } else if (code === 'Q') {
        const x1 = abs ? a[0]! : cx + a[0]!
        const y1 = abs ? a[1]! : cy + a[1]!
        const x = abs ? a[2]! : cx + a[2]!
        const y = abs ? a[3]! : cy + a[3]!
        const p0 = { x: cx, y: cy }
        flattenQuadratic(p0, { x: x1, y: y1 }, { x, y }, tolerance, points)
        cx = x
        cy = y
        prevCtrl = { x: x1, y: y1 }
      } else if (code === 'T') {
        const x = abs ? a[0]! : cx + a[0]!
        const y = abs ? a[1]! : cy + a[1]!
        let x1 = cx
        let y1 = cy
        if (prevCode === 'Q' || prevCode === 'T') {
          x1 = 2 * cx - (prevCtrl?.x ?? cx)
          y1 = 2 * cy - (prevCtrl?.y ?? cy)
        }
        const p0 = { x: cx, y: cy }
        flattenQuadratic(p0, { x: x1, y: y1 }, { x, y }, tolerance, points)
        cx = x
        cy = y
        prevCtrl = { x: x1, y: y1 }
      } else if (code === 'A') {
        const rx = a[0]!
        const ry = a[1]!
        const rot = a[2]!
        const large = a[3]! !== 0
        const sweep = a[4]! !== 0
        const x = abs ? a[5]! : cx + a[5]!
        const y = abs ? a[6]! : cy + a[6]!
        const p0 = { x: cx, y: cy }
        const result = flattenArc(
          p0,
          rx,
          ry,
          rot,
          large,
          sweep,
          { x, y },
          tolerance,
          points,
        )
        if (!result.ok) {
          warnings.push({
            code: 'invalid_arc',
            message: result.reason ?? 'Invalid arc',
            element,
          })
          points.push({ x, y })
        }
        cx = x
        cy = y
        prevCtrl = null
      }

      prevCode = code
    }
  }

  if (points.length) commit()
  return subpaths
}
