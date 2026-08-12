import type { NestSettings as UiNestSettings, SheetSettings as UiSheetSettings } from '../state'
import type { GeometryPart } from '../geometry'
import { coarseFreeAngles } from './optimization/rotations'
import type { NestInput, NestingRequest, NestingSettings, SheetDefinition } from './types'
import { validateNestingRequest } from './core/validate'

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
      quantity: Math.max(1, parts.length),
    },
  ]

  // Search starts on the coarse grid; full placement checks every integer degree.
  const nestingSettings: NestingSettings = {
    spacingMm: settings.gapMm,
    allowedRotations: coarseFreeAngles(),
    allowedRotationsExplicit: null,
    rotationStepDeg: null,
    allowArbitraryRotation: true,
    rotationMode: 'free',
    allowRotation: true,
    seed: settings.seed,
    deterministic: settings.deterministic,
    allowPartInPart: settings.allowPartInPart,
    dayamaX: true,
    dayamaY: true,
  }

  const request = { parts, sheets, settings: nestingSettings }
  validateNestingRequest(request)
  return request
}

export function nestInputToRequest(input: NestInput): NestingRequest {
  return toNestingRequest(input.parts, input.sheet, input.settings)
}
