import type { SvgMeta } from '../state'
import { parseSvgGeometry, type ParseGeometryOptions } from './parseGeometry'

export function parseSvgMeta(
  fileName: string,
  raw: string,
  options?: ParseGeometryOptions,
): SvgMeta {
  const geometry = parseSvgGeometry(raw, options)

  return {
    fileName,
    raw,
    width: geometry.widthMm,
    height: geometry.heightMm,
    partCount: geometry.partCount,
    parts: geometry.parts,
    warnings: geometry.warnings,
    bounds: geometry.bounds,
    totalArea: geometry.totalArea,
  }
}

export async function readSvgFile(
  file: File,
  options?: ParseGeometryOptions,
): Promise<SvgMeta> {
  if (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml') {
    throw new Error('Yalnızca SVG dosyaları desteklenir.')
  }
  const raw = await file.text()
  const meta = parseSvgMeta(file.name, raw, options)
  const malformed = meta.warnings.some((w) => w.code === 'malformed_svg')
  if (malformed && meta.partCount === 0 && !/<svg[\s>]/i.test(raw)) {
    throw new Error('SVG dosyası okunamadı. Geçerli bir SVG yükleyin.')
  }
  return meta
}
