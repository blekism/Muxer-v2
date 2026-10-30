import type {
  AudioSettings,
  EditorSettings,
  ExportQuality,
  SourceEditSettings,
  TextStyle,
  VideoProps
} from '../../types'

/** These families must be installed or bundled with the app (and FFmpeg needs the font files too). */
export const FONT_OPTIONS = [
  'Montserrat',
  'Poppins',
  'Inter',
  'Oswald',
  'Anton',
  'Bebas Neue',
  'Roboto',
  'Arial Black'
] as const

export const fontStack = (font: string) => `"${font}", system-ui, sans-serif`

export const TEXT_SWATCHES = [
  '#ffffff',
  '#000000',
  '#ffe14d',
  '#ff5c7a',
  '#4dd2ff',
  '#7cff6b'
] as const

export const QUALITY_OPTIONS: readonly { value: ExportQuality; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
]

export interface VideoControl {
  key: keyof VideoProps
  label: string
  min: number
  max: number
  step: number
  unit: string
  /** Value that means "no change": the default, and the 0 point when normalizing for the preview. */
  neutral: number
  /** Range used by "Randomize". Same units as `min`/`max`. */
  randomRange: readonly [number, number]
  /** Readout next to the slider. Falls back to value + unit. */
  format?: (value: number) => string
}

/**
 * Every value below is stored in the units FFmpeg receives, so export.ts can use it as-is.
 * Anything the CSS preview can't use directly is converted in previewMath.ts (never here, never in export).
 */
export const TEMPERATURE_KELVIN = { min: 4200, max: 6800, neutral: 6500 } as const
/** Must equal the `mix` that export.ts passes to colortemperature. */
export const TEMPERATURE_MIX = 0.5
export const PERSPECTIVE_MAX = 0.005
/** colorbalance green lift (gs): spike2.mjs randomizes each channel within +-0.025. */
export const TINT_MAX = 0.025
/** vignette lens angle in radians. Larger = stronger. spike2.mjs randomizes 0.1 to 0.2. */
export const VIGNETTE_MAX_ANGLE = 0.2

export const VIDEO_CONTROLS: readonly VideoControl[] = [
  {
    key: 'zoom',
    label: 'Zoom',
    min: 1,
    max: 1.18,
    step: 0.01,
    unit: '×',
    neutral: 1,
    randomRange: [1.06, 1.18],
    format: (value) => `${value.toFixed(2)}×`
  },
  {
    key: 'rotation',
    label: 'Rotation',
    min: -1,
    max: 1,
    step: 0.1,
    unit: '°',
    neutral: 0,
    randomRange: [-1, 1],
    format: (value) => `${value.toFixed(1)}°`
  },
  {
    key: 'perspective',
    label: 'Perspective',
    min: -PERSPECTIVE_MAX,
    max: PERSPECTIVE_MAX,
    step: 0.001,
    unit: '',
    neutral: 0,
    randomRange: [-PERSPECTIVE_MAX, PERSPECTIVE_MAX],
    format: (value) => `${(value * 100).toFixed(1)}%`
  },
  {
    key: 'trimStart',
    label: 'Trim start',
    min: 0,
    max: 5,
    step: 0.1,
    unit: 's',
    neutral: 0,
    randomRange: [0, 1],
    format: (value) => `${value.toFixed(1)}s`
  },
  {
    key: 'temperature',
    label: 'Color temperature',
    min: TEMPERATURE_KELVIN.min,
    max: TEMPERATURE_KELVIN.max,
    step: 50,
    unit: 'K',
    neutral: TEMPERATURE_KELVIN.neutral,
    randomRange: [TEMPERATURE_KELVIN.min, TEMPERATURE_KELVIN.max],
    format: (value) => `${Math.round(value)}K`
  },
  {
    key: 'tint',
    label: 'Tint',
    min: -TINT_MAX,
    max: TINT_MAX,
    step: 0.001,
    unit: '',
    neutral: 0,
    randomRange: [-TINT_MAX, TINT_MAX],
    format: (value) => `${value > 0 ? '+' : ''}${value.toFixed(3)}`
  },
  {
    key: 'vignette',
    label: 'Vignette',
    min: 0,
    max: VIGNETTE_MAX_ANGLE,
    step: 0.005,
    unit: '',
    neutral: 0,
    randomRange: [0.1, VIGNETTE_MAX_ANGLE],
    format: (value) => `${Math.round((value / VIGNETTE_MAX_ANGLE) * 100)}%`
  }
]

export const DEFAULT_TEXT: TextStyle = {
  font: 'Montserrat',
  size: 56,
  outline: 4,
  fill: '#ffffff',
  outlineColor: '#000000',
  vAlign: 'bottom',
  hAlign: 'center'
}

/** Derived from the controls so defaults can never drift from the neutral values. */
export const DEFAULT_VIDEO = Object.fromEntries(
  VIDEO_CONTROLS.map((control) => [control.key, control.neutral])
) as unknown as VideoProps

export const DEFAULT_AUDIO: AudioSettings = {
  originalEnabled: true,
  musicId: null
}

export const INITIAL_SOURCE_SETTINGS: SourceEditSettings = {
  text: DEFAULT_TEXT,
  video: DEFAULT_VIDEO,
  audio: DEFAULT_AUDIO,
  captionPresetId: null
}

export const INITIAL_SETTINGS: EditorSettings = {
  sourceSettings: {},
  quality: 'high',
  activeSourceId: null
}
