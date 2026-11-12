/** Color constants that both the CSS preview (renderer) and the FFmpeg export (main) depend on. */

/**
 * FFmpeg colortemperature slider range and neutral point, in Kelvin. Lower = warmer.
 * spike2.mjs randomizes 5100 to 5900; the range extends up to neutral so the default means "no change".
 */
export const TEMPERATURE_KELVIN = { min: 5100, max: 6500, neutral: 6500 } as const

/** `mix` passed to colortemperature (spike2.mjs uses 1). The preview blends the black-body multiplier by the same amount. */
export const TEMPERATURE_MIX = 1

/** vignette lens angle in radians. Larger = stronger. spike2.mjs randomizes 0.02 to 0.08. */
export const VIGNETTE_MAX_ANGLE = 0.08
