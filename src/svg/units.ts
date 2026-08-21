import type { ParserWarning } from './warnings'

/** CSS/SVG reference: 1in = 96px, 1in = 25.4mm */
const PX_PER_IN = 96
const MM_PER_IN = 25.4
const MM_PER_PX = MM_PER_IN / PX_PER_IN
const MM_PER_PT = MM_PER_IN / 72

export type Length = {
  value: number
  unit: string | null
}

const LENGTH_RE =
  /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|mm|cm|in|pt|pc|%)?$/i

export function parseLength(raw: string | null | undefined): Length | null {
  if (raw == null) return null
  const s = raw.trim()
  if (!s) return null
  const m = s.match(LENGTH_RE)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  return { value, unit: m[2] ? m[2].toLowerCase() : null }
}

/** Convert an absolute length to millimeters. Percent returns null. */
export function lengthToMm(
  length: Length,
  opts?: { percentOfMm?: number },
): number | null {
  switch (length.unit) {
    case null:
    case 'px':
      return length.value * MM_PER_PX
    case 'mm':
      return length.value
    case 'cm':
      return length.value * 10
    case 'in':
      return length.value * MM_PER_IN
    case 'pt':
      return (length.value / 72) * MM_PER_IN
    case 'pc':
      return (length.value / 6) * MM_PER_IN
    case '%':
      if (opts?.percentOfMm == null) return null
      return (length.value / 100) * opts.percentOfMm
    default:
      return null
  }
}

export type UserToMm = {
  sx: number
  sy: number
  offsetXMm: number
  offsetYMm: number
  supported: boolean
  /** Document width/height in mm when known. */
  widthMm: number | null
  heightMm: number | null
  viewBox: { minX: number; minY: number; width: number; height: number } | null
}

/**
 * Map SVG user units → mm using width/height + viewBox.
 * If physical size is omitted, treat user units as CSS px (96dpi), unless the
 * source explicitly identifies Adobe Illustrator's point-based export.
 */
export function resolveUserToMm(
  widthAttr: string | null,
  heightAttr: string | null,
  viewBoxAttr: string | null,
  warnings: ParserWarning[],
  preserveAspectRatioAttr: string | null = null,
  defaultUserUnit: 'px' | 'pt' = 'px',
): UserToMm {
  const defaultUserUnitMm = defaultUserUnit === 'pt' ? MM_PER_PT : MM_PER_PX
  const viewBox = parseViewBox(viewBoxAttr)
  const wLen = parseLength(widthAttr)
  const hLen = parseLength(heightAttr)

  const invalidLength = (raw: string | null, parsed: Length | null) =>
    raw !== null &&
    (parsed === null || parsed.unit === '%' || parsed.value <= 0)
  if (
    invalidLength(widthAttr, wLen) ||
    invalidLength(heightAttr, hLen) ||
    (viewBoxAttr !== null && viewBox === null)
  ) {
    warnings.push({
      code: 'invalid_dimensions',
      message: 'Malformed or unsupported SVG dimensions.',
    })
    return {
      sx: MM_PER_PX,
      sy: MM_PER_PX,
      offsetXMm: 0,
      offsetYMm: 0,
      supported: false,
      widthMm: null,
      heightMm: null,
      viewBox: null,
    }
  }

  let widthMm =
    wLen && wLen.unit !== '%'
      ? lengthToMm(wLen)
      : null
  let heightMm =
    hLen && hLen.unit !== '%'
      ? lengthToMm(hLen)
      : null

  if (widthMm == null && heightMm == null && viewBox) {
    // No physical size: use the source application's user-unit convention.
    return {
      sx: defaultUserUnitMm,
      sy: defaultUserUnitMm,
      offsetXMm: 0,
      offsetYMm: 0,
      supported: true,
      widthMm: viewBox.width * defaultUserUnitMm,
      heightMm: viewBox.height * defaultUserUnitMm,
      viewBox,
    }
  }

  if (widthMm == null && heightMm == null && !viewBox) {
    return {
      sx: MM_PER_PX,
      sy: MM_PER_PX,
      offsetXMm: 0,
      offsetYMm: 0,
      supported: true,
      widthMm: null,
      heightMm: null,
      viewBox: null,
    }
  }

  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    if (widthMm == null && heightMm != null) {
      widthMm = (viewBox.width / viewBox.height) * heightMm
    }
    if (heightMm == null && widthMm != null) {
      heightMm = (viewBox.height / viewBox.width) * widthMm
    }
    if (widthMm == null) widthMm = viewBox.width * defaultUserUnitMm
    if (heightMm == null) heightMm = viewBox.height * defaultUserUnitMm
    const rawSx = widthMm / viewBox.width
    const rawSy = heightMm / viewBox.height
    const preserve = parsePreserveAspectRatio(preserveAspectRatioAttr)
    if (!preserve) {
      warnings.push({
        code: 'invalid_dimensions',
        message: 'Unsupported or malformed preserveAspectRatio value.',
      })
      return {
        sx: rawSx,
        sy: rawSy,
        offsetXMm: 0,
        offsetYMm: 0,
        supported: false,
        widthMm,
        heightMm,
        viewBox,
      }
    }
    const uniform = preserve.none ? null : Math.min(rawSx, rawSy)
    const sx = uniform ?? rawSx
    const sy = uniform ?? rawSy
    return {
      sx,
      sy,
      offsetXMm: (widthMm - viewBox.width * sx) * preserve.alignX,
      offsetYMm: (heightMm - viewBox.height * sy) * preserve.alignY,
      supported: true,
      widthMm,
      heightMm,
      viewBox,
    }
  }

  // No viewBox: numeric width/height values are the user-space size.
  const userW = wLen?.value ?? null
  const userH = hLen?.value ?? null
  if (widthMm != null && userW != null && userW !== 0) {
    const sx = widthMm / userW
    const sy =
      heightMm != null && userH != null && userH !== 0
        ? heightMm / userH
        : sx
    return {
      sx,
      sy,
      offsetXMm: 0,
      offsetYMm: 0,
      supported: true,
      widthMm,
      heightMm: heightMm ?? (userH != null ? userH * sy : null),
      viewBox: null,
    }
  }

  return {
    sx: MM_PER_PX,
    sy: MM_PER_PX,
    offsetXMm: 0,
    offsetYMm: 0,
    supported: true,
    widthMm,
    heightMm,
    viewBox,
  }
}

function parsePreserveAspectRatio(
  attr: string | null,
): { none: boolean; alignX: number; alignY: number } | null {
  const tokens = (attr?.trim() || 'xMidYMid meet').split(/\s+/)
  if (tokens[0] === 'defer') tokens.shift()
  if (tokens[0] === 'none') {
    return tokens.length === 1
      ? { none: true, alignX: 0, alignY: 0 }
      : null
  }
  const match = /^(xMin|xMid|xMax)(YMin|YMid|YMax)$/.exec(tokens[0] ?? '')
  if (!match || tokens.length > 2 || (tokens[1] && tokens[1] !== 'meet')) {
    return null
  }
  const align = (value: string) =>
    value.endsWith('Min') ? 0 : value.endsWith('Mid') ? 0.5 : 1
  return {
    none: false,
    alignX: align(match[1]!),
    alignY: align(match[2]!),
  }
}

export function parseViewBox(
  attr: string | null,
): { minX: number; minY: number; width: number; height: number } | null {
  if (!attr) return null
  const parts = attr
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [minX, minY, width, height] = parts as [number, number, number, number]
  if (width <= 0 || height <= 0) return null
  return { minX, minY, width, height }
}

export function userPointToMm(
  x: number,
  y: number,
  scale: UserToMm,
): { x: number; y: number } {
  const ox = scale.viewBox?.minX ?? 0
  const oy = scale.viewBox?.minY ?? 0
  return {
    x: (x - ox) * scale.sx + scale.offsetXMm,
    y: (y - oy) * scale.sy + scale.offsetYMm,
  }
}
