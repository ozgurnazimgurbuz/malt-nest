import type { NestSettings, SheetSettings } from './types'

export const DEFAULT_SHEET: SheetSettings = {
  widthMm: 2050,
  heightMm: 3050,
}

export const DEFAULT_NEST: NestSettings = {
  gapMm: 5,
  marginMm: 10,
  allowRotation: true,
  rotationAngles: [0, 90, 180, 270],
  optimizationLevel: 'balanced',
  rotationMode: 'orthogonal',
  allowPartInPart: false,
  seed: 42,
  deterministic: false,
}

export const ROTATION_OPTIONS = [0, 90, 180, 270] as const

export const OPTIMIZATION_OPTIONS = [
  { id: 'fast' as const, label: 'Fast (~0.5s)' },
  { id: 'balanced' as const, label: 'Balanced (~2s)' },
  { id: 'deep' as const, label: 'Deep (~10s)' },
]

export const ROTATION_MODE_OPTIONS = [
  { id: 'orthogonal' as const, label: 'Orthogonal (0/90/180/270)' },
  { id: 'balanced' as const, label: 'Balanced (45° steps)' },
  { id: 'deep' as const, label: 'Deep (adaptive)' },
]
