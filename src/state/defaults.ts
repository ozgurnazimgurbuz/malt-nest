import type { NestSettings, SheetSettings } from './types'

export const DEFAULT_SHEET: SheetSettings = {
  widthMm: 2050,
  heightMm: 3050,
}

export const DEFAULT_NEST: NestSettings = {
  gapMm: 5,
  marginMm: 10,
  optimizationLevel: 'balanced',
  allowPartInPart: false,
  seed: 42,
  deterministic: false,
}

export const OPTIMIZATION_OPTIONS = [
  { id: 'fast' as const, label: 'Fast (~0.5s)' },
  { id: 'balanced' as const, label: 'Balanced (~2s)' },
  { id: 'deep' as const, label: 'Deep (~10s)' },
]
