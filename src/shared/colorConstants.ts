/** Color constants that both the CSS preview (renderer) and the FFmpeg export (main) depend on. */

/** FFmpeg colortemperature range and neutral point, in Kelvin (from spike2.mjs). Lower = warmer. */
export const TEMPERATURE_KELVIN = { min: 4200, max: 6800, neutral: 6500 } as const

/** `mix` passed to colortemperature. The preview blends the black-body multiplier by the same amount. */
export const TEMPERATURE_MIX = 0.5

/** colorbalance shadow green lift (gs). spike2.mjs randomizes each channel within +-0.025. */
export const TINT_MAX = 0.025

/** vignette lens angle in radians. Larger = stronger. spike2.mjs randomizes 0.1 to 0.2. */
export const VIGNETTE_MAX_ANGLE = 0.2
