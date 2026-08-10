import type { ParserWarning } from './warnings'

/** CSS/SVG reference: 1in = 96px, 1in = 25.4mm */
const PX_PER_IN = 96
const MM_PER_IN = 25.4
const MM_PER_PX = MM_PER_IN / PX_PER_IN

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
  /** Document width/height in mm when known. */
  widthMm: number | null
  heightMm: number | null
  viewBox: { minX: number; minY: number; width: number; height: number } | null
}

/**
 * Map SVG user units → mm using width/height + viewBox.
 * If physical size is omitted, treat user units as CSS px (96dpi).
 */
export function resolveUserToMm(
  widthAttr: string | null,
  heightAttr: string | null,
  viewBoxAttr: string | null,
  warnings: ParserWarning[],
): UserToMm {
  const viewBox = parseViewBox(viewBoxAttr)
  const wLen = parseLength(widthAttr)
  const hLen = parseLength(heightAttr)

  let widthMm =
    wLen && wLen.unit !== '%'
      ? lengthToMm(wLen)
      : null
  let heightMm =
    hLen && hLen.unit !== '%'
      ? lengthToMm(hLen)
      : null

  if (wLen?.unit === '%' || hLen?.unit === '%') {
    warnings.push({
      code: 'invalid_dimensions',
      message: 'Percentage width/height is not fully supported without a parent size.',
    })
  }

  if (widthMm == null && heightMm == null && viewBox) {
    // No physical size: user unit = px
    return {
      sx: MM_PER_PX,
      sy: MM_PER_PX,
      widthMm: viewBox.width * MM_PER_PX,
      heightMm: viewBox.height * MM_PER_PX,
      viewBox,
    }
  }

  if (widthMm == null && heightMm == null && !viewBox) {
    return {
      sx: MM_PER_PX,
      sy: MM_PER_PX,
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
    if (widthMm == null) widthMm = viewBox.width * MM_PER_PX
    if (heightMm == null) heightMm = viewBox.height * MM_PER_PX
    return {
      sx: widthMm / viewBox.width,
      sy: heightMm / viewBox.height,
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
      widthMm,
      heightMm: heightMm ?? (userH != null ? userH * sy : null),
      viewBox: null,
    }
  }

  return {
    sx: MM_PER_PX,
    sy: MM_PER_PX,
    widthMm,
    heightMm,
    viewBox,
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
    x: (x - ox) * scale.sx,
    y: (y - oy) * scale.sy,
  }
}
