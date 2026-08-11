import type { Point, Ring } from '../types'
import { DEFAULT_TOLERANCE, type GeometryTolerance } from '../tolerance'
import { flattenArc, flattenCubic, flattenQuadratic } from './flatten'

type Cmd =
  | { t: 'M' | 'L'; x: number; y: number; rel: boolean }
  | { t: 'H'; x: number; rel: boolean }
  | { t: 'V'; y: number; rel: boolean }
  | {
      t: 'C'
      x1: number
      y1: number
      x2: number
      y2: number
      x: number
      y: number
      rel: boolean
    }
  | {
      t: 'S'
      x2: number
      y2: number
      x: number
      y: number
      rel: boolean
    }
  | {
      t: 'Q'
      x1: number
      y1: number
      x: number
      y: number
      rel: boolean
    }
  | { t: 'T'; x: number; y: number; rel: boolean }
  | {
      t: 'A'
      rx: number
      ry: number
      rot: number
      large: boolean
      sweep: boolean
      x: number
      y: number
      rel: boolean
    }
  | { t: 'Z' }

function tokenizePath(d: string): Cmd[] {
  const cmds: Cmd[] = []
  const re =
    /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g
  const tokens: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    if (m[1]) tokens.push(m[1])
    else if (m[2]) tokens.push(m[2])
  }

  let i = 0
  const num = () => {
    const v = Number(tokens[i++])
    if (!Number.isFinite(v)) throw new Error('Invalid path number')
    return v
  }
  const flag = () => num() !== 0

  while (i < tokens.length) {
    const op = tokens[i++]!
    const rel = op === op.toLowerCase()
    const t = op.toUpperCase()
    if (t === 'Z') {
      cmds.push({ t: 'Z' })
      continue
    }
    // Implicit command repetition: after first, numbers continue same cmd
    const pushLoop = (read: () => void) => {
      read()
      while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!)) read()
    }
    if (t === 'M') {
      cmds.push({ t: 'M', x: num(), y: num(), rel })
      while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!)) {
        cmds.push({ t: 'L', x: num(), y: num(), rel })
      }
    } else if (t === 'L') {
      pushLoop(() => {
        cmds.push({ t: 'L', x: num(), y: num(), rel })
      })
    } else if (t === 'H') {
      pushLoop(() => cmds.push({ t: 'H', x: num(), rel }))
    } else if (t === 'V') {
      pushLoop(() => cmds.push({ t: 'V', y: num(), rel }))
    } else if (t === 'C') {
      pushLoop(() =>
        cmds.push({
          t: 'C',
          x1: num(),
          y1: num(),
          x2: num(),
          y2: num(),
          x: num(),
          y: num(),
          rel,
        }),
      )
    } else if (t === 'S') {
      pushLoop(() =>
        cmds.push({
          t: 'S',
          x2: num(),
          y2: num(),
          x: num(),
          y: num(),
          rel,
        }),
      )
    } else if (t === 'Q') {
      pushLoop(() =>
        cmds.push({
          t: 'Q',
          x1: num(),
          y1: num(),
          x: num(),
          y: num(),
          rel,
        }),
      )
    } else if (t === 'T') {
      pushLoop(() => cmds.push({ t: 'T', x: num(), y: num(), rel }))
    } else if (t === 'A') {
      pushLoop(() =>
        cmds.push({
          t: 'A',
          rx: num(),
          ry: num(),
          rot: num(),
          large: flag(),
          sweep: flag(),
          x: num(),
          y: num(),
          rel,
        }),
      )
    } else {
      throw new Error(`Unsupported path command: ${op}`)
    }
  }
  return cmds
}

/**
 * Convert SVG path `d` into one or more closed rings (subpaths).
 * Open subpaths are left open (caller may close); Z closes.
 */
export function pathToRings(
  d: string,
  tol: GeometryTolerance = DEFAULT_TOLERANCE,
): Ring[] {
  const cmds = tokenizePath(d)
  const rings: Ring[] = []
  let cur: Point = { x: 0, y: 0 }
  let start: Point = { x: 0, y: 0 }
  let pts: Point[] = []
  let lastC2: Point | null = null
  let lastQ: Point | null = null
  let lastWasCurve = false
  let lastWasQuad = false

  const abs = (x: number, y: number, rel: boolean): Point =>
    rel ? { x: cur.x + x, y: cur.y + y } : { x, y }

  const pushPts = (more: Point[]) => {
    for (const p of more) {
      const last = pts[pts.length - 1]
      if (last && last.x === p.x && last.y === p.y) continue
      pts.push(p)
    }
  }

  const finishSub = () => {
    if (pts.length >= 3) rings.push(pts)
    pts = []
  }

  for (const c of cmds) {
    if (c.t === 'M') {
      finishSub()
      cur = abs(c.x, c.y, c.rel)
      start = cur
      pts = [cur]
      lastWasCurve = false
      lastWasQuad = false
      // subsequent pairs in M are treated as L by tokenizer as separate M —
      // we emitted only first M; extra M from pushLoop are still M.
      // Treat non-first M as L if we already have points in subpath after finish.
    } else if (c.t === 'L') {
      cur = abs(c.x, c.y, c.rel)
      pushPts([cur])
      lastWasCurve = false
      lastWasQuad = false
    } else if (c.t === 'H') {
      cur = { x: c.rel ? cur.x + c.x : c.x, y: cur.y }
      pushPts([cur])
      lastWasCurve = false
      lastWasQuad = false
    } else if (c.t === 'V') {
      cur = { x: cur.x, y: c.rel ? cur.y + c.y : c.y }
      pushPts([cur])
      lastWasCurve = false
      lastWasQuad = false
    } else if (c.t === 'C') {
      const c1 = abs(c.x1, c.y1, c.rel)
      const c2 = abs(c.x2, c.y2, c.rel)
      const p = abs(c.x, c.y, c.rel)
      const flat = flattenCubic(cur, c1, c2, p, tol)
      pushPts(flat.slice(1))
      lastC2 = c2
      cur = p
      lastWasCurve = true
      lastWasQuad = false
    } else if (c.t === 'S') {
      const c2 = abs(c.x2, c.y2, c.rel)
      const p = abs(c.x, c.y, c.rel)
      const c1 =
        lastWasCurve && lastC2
          ? { x: 2 * cur.x - lastC2.x, y: 2 * cur.y - lastC2.y }
          : cur
      const flat = flattenCubic(cur, c1, c2, p, tol)
      pushPts(flat.slice(1))
      lastC2 = c2
      cur = p
      lastWasCurve = true
      lastWasQuad = false
    } else if (c.t === 'Q') {
      const c1 = abs(c.x1, c.y1, c.rel)
      const p = abs(c.x, c.y, c.rel)
      const flat = flattenQuadratic(cur, c1, p, tol)
      pushPts(flat.slice(1))
      lastQ = c1
      cur = p
      lastWasCurve = false
      lastWasQuad = true
    } else if (c.t === 'T') {
      const p = abs(c.x, c.y, c.rel)
      const c1: Point =
        lastWasQuad && lastQ
          ? { x: 2 * cur.x - lastQ.x, y: 2 * cur.y - lastQ.y }
          : cur
      const flat = flattenQuadratic(cur, c1, p, tol)
      pushPts(flat.slice(1))
      lastQ = c1
      cur = p
      lastWasCurve = false
      lastWasQuad = true
    } else if (c.t === 'A') {
      const p = abs(c.x, c.y, c.rel)
      const flat = flattenArc(
        cur,
        c.rx,
        c.ry,
        c.rot,
        c.large,
        c.sweep,
        p,
        tol,
      )
      pushPts(flat.slice(1))
      cur = p
      lastWasCurve = false
      lastWasQuad = false
    } else if (c.t === 'Z') {
      cur = start
      finishSub()
      lastWasCurve = false
      lastWasQuad = false
    }
  }
  finishSub()
  return rings
}
