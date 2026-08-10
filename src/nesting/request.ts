import type { NestSettings as UiNestSettings, SheetSettings as UiSheetSettings } from '../state'
import type { GeometryPart } from '../geometry'
import { presetForLevel } from './optimization/presets'
import type { NestInput, NestingRequest, NestingSettings, SheetDefinition } from './types'

/** Map Stage 1 UI sheet + nest settings into an engine NestingRequest. */
export function toNestingRequest(
  parts: GeometryPart[],
  sheet: UiSheetSettings,
  settings: UiNestSettings,
): NestingRequest {
  const sheets: SheetDefinition[] = [
    {
      widthMm: sheet.widthMm,
      heightMm: sheet.heightMm,
      marginMm: settings.marginMm,
      quantity: 100,
    },
  ]

  const level = settings.optimizationLevel
  const preset = presetForLevel(level)

  const nestingSettings: NestingSettings = {
    spacingMm: settings.gapMm,
    allowedRotations: settings.allowRotation
      ? [...settings.rotationAngles]
      : [0],
    rotationStepDeg: null,
    allowArbitraryRotation: settings.rotationMode === 'deep',
    rotationMode: settings.allowRotation ? settings.rotationMode : 'orthogonal',
    allowRotation: settings.allowRotation,
    optimizationLevel: level,
    timeLimitMs: preset.timeLimitMs,
    seed: settings.seed,
    deterministic: settings.deterministic,
    allowPartInPart: settings.allowPartInPart,
    dayamaX: settings.dayamaX,
    dayamaY: settings.dayamaY,
  }

  return { parts, sheets, settings: nestingSettings }
}

export function nestInputToRequest(input: NestInput): NestingRequest {
  return toNestingRequest(input.parts, input.sheet, input.settings)
}
