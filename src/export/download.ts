import type { ExportedSheetSvg } from './svg/serialize'
import { zipFileName } from './svg/filenames'
import { buildZip } from './zip'

function triggerDownload(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadTextFile(
  fileName: string,
  text: string,
  mime: string,
): void {
  triggerDownload(fileName, new Blob([text], { type: mime }))
}

export function downloadBytes(
  fileName: string,
  bytes: Uint8Array,
  mime: string,
): void {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  triggerDownload(fileName, new Blob([copy], { type: mime }))
}

export function downloadSvgSheet(sheet: ExportedSheetSvg): void {
  downloadTextFile(sheet.fileName, sheet.svg, 'image/svg+xml;charset=utf-8')
}

/** One sheet → SVG download; multiple → ZIP (store-only, no extra dependency). */
export function downloadAllSvgSheets(
  sheets: ExportedSheetSvg[],
  sourceFileName?: string | null,
): void {
  if (sheets.length === 0) return
  if (sheets.length === 1) {
    downloadSvgSheet(sheets[0]!)
    return
  }
  const zip = buildZip(sheets.map((s) => ({ name: s.fileName, data: s.svg })))
  downloadBytes(zipFileName(sourceFileName), zip, 'application/zip')
}
