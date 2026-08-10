export function sanitizeBaseName(name: string): string {
  const stripped = name.replace(/\.[^.]+$/i, '')
  const base = stripped
    .split(/[/\\]/)
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base.length ? base.slice(0, 80) : 'malt-nest'
}

export function sheetFileName(
  sourceFileName: string | null | undefined,
  sheetIndex: number,
): string {
  const base = sanitizeBaseName(sourceFileName ?? 'malt-nest')
  const n = String(sheetIndex + 1).padStart(2, '0')
  return `${base}-nested-${n}.svg`
}

export function zipFileName(sourceFileName: string | null | undefined): string {
  const base = sanitizeBaseName(sourceFileName ?? 'malt-nest')
  return `${base}-nested.zip`
}
