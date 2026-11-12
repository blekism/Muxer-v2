import { PERSPECTIVE_MAX, TEMPERATURE_KELVIN, TEMPERATURE_MIX } from './config'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * FFmpeg's colortemperature filter multiplies each channel by the color of a black body at that temperature
 * (normalized so the brightest channel is 1), then blends the result with the original by `mix`:
 *   out = in * ((1 - mix) + mix * blackBody(K))
 * Measured against FFmpeg 7: 4200K at mix 0.5 turns mid-gray (128) into (128, 116, 107). Red is untouched,
 * green and blue are dimmed (lower Kelvin = warmer). The preview does the same per-channel multiplication with
 * an SVG feColorMatrix.
 * The formula is the common black-body fit and matches FFmpeg to within 0.004 for 4200K to 6800K.
 */
function kelvinToMultiplier(kelvin: number): [number, number, number] {
  const t = kelvin / 100
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return [red, green, blue].map((channel) => clamp(channel, 0, 255) / 255) as [
    number,
    number,
    number
  ]
}

const IDENTITY_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0'

/**
 * SVG feColorMatrix that applies colortemperature: each channel times (1 - mix) + mix * blackBody(K).
 * export.ts skips the filter at the neutral 6500K, so the preview uses the identity matrix there too.
 */
export function temperatureMatrix(kelvin: number): string {
  if (kelvin === TEMPERATURE_KELVIN.neutral) return IDENTITY_MATRIX
  const [red, green, blue] = kelvinToMultiplier(kelvin).map(
    (multiplier) => 1 - TEMPERATURE_MIX + TEMPERATURE_MIX * multiplier
  )
  return `${red} 0 0 0 0  0 ${green} 0 0 0  0 0 ${blue} 0 0  0 0 0 1 0`
}

const LUMA = [0.2126, 0.7152, 0.0722] as const // BT.709, what Chromium decodes with

/**
 * FFmpeg's eq: luma' = contrast * (Y - 0.5) + 0.5 + brightness, chroma' = saturation * (C - 0.5) + 0.5.
 * In RGB (c = Y + chroma part) that is c' = sat * c + (contrast - sat) * Y + 0.5 - 0.5 * contrast + brightness,
 * one feColorMatrix. eq runs on YUV before the other color filters, so this goes first in the preview filter too.
 */
export function eqMatrix(brightness: number, contrast: number, saturation: number): string {
  const offset = 0.5 - 0.5 * contrast + brightness
  const lumaPart = LUMA.map((coefficient) => (contrast - saturation) * coefficient)
  const row = (channel: number): string =>
    lumaPart.map((value, index) => value + (index === channel ? saturation : 0)).join(' ') +
    ` 0 ${offset}`
  return `${row(0)}  ${row(1)}  ${row(2)}  0 0 0 1 0`
}

export const isEqNeutral = (brightness: number, contrast: number, saturation: number): boolean =>
  brightness === 0 && contrast === 1 && saturation === 1

/**
 * Native vignette is FFmpeg's lens angle in radians. The filter multiplies each pixel by cos(angle * d)^4,
 * where d is the distance from the center divided by the distance to the corner. This draws that same falloff,
 * so the preview shows exactly the darkness the export applies (it is subtle at the spike's 0.02 to 0.08 range).
 */
export function vignetteGradient(angle: number): string {
  if (angle <= 0) return 'none'
  const steps = 8
  const stops = Array.from({ length: steps + 1 }, (_, index) => {
    const distance = index / steps
    const alpha = 1 - Math.cos(angle * distance) ** 4
    return `rgb(0 0 0 / ${alpha.toFixed(4)}) ${(distance * 100).toFixed(1)}%`
  })
  return `radial-gradient(circle farthest-corner at center, ${stops.join(', ')})`
}

// Virtual camera distance, in frame widths. Only affects how the tilt looks, not how strong it is.
const PERSPECTIVE_DISTANCE = 1.5
const HALF_FRAME_HEIGHT = 16 / 18 // frame is 9:16, so half its height is 8/9 of its width

/**
 * export.ts maps the top edge of the source onto the full width (perspective filter, sense=source), so a
 * positive value enlarges the top edge by 1 / (1 - 2 * value). A rotateX around the frame center produces the
 * same top-edge scale when sin(angle) = 2 * value * distance / halfHeight. Positive value = top toward the viewer.
 * Flip the sign here if the preview ever tilts the opposite way from the export.
 */
export function perspectiveToRotateXDeg(value: number): number {
  const limited = clamp(value, -PERSPECTIVE_MAX, PERSPECTIVE_MAX)
  const sine = (2 * Math.abs(limited) * PERSPECTIVE_DISTANCE) / HALF_FRAME_HEIGHT
  return -Math.sign(limited) * ((Math.asin(sine) * 180) / Math.PI)
}

export const PERSPECTIVE_CSS_DISTANCE = `${PERSPECTIVE_DISTANCE * 100}cqw`
