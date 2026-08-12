import type { NestSettings, SheetSettings } from './types'

export const DEFAULT_SHEET: SheetSettings = {
  widthMm: 2050,
  heightMm: 3050,
}

export const DEFAULT_NEST: NestSettings = {
  gapMm: 5,
  marginMm: 10,
  allowPartInPart: false,
  seed: 42,
  deterministic: false,
}
