import type { TextCase } from './types'

/** Caption fonts. The same .ttf files in `resources/fonts` feed the CSS preview and FFmpeg's drawtext. */
export interface FontOption {
  id: string
  label: string
  /** CSS family name registered by @font-face (or a system family when `file` is null). */
  family: string
  weight: number
  /** File name inside resources/fonts, or null to use a system font. */
  file: string | null
}

export const FONTS: readonly FontOption[] = [
  { id: 'SF Pro', label: 'SF Pro', family: 'system-ui', weight: 700, file: null },
  { id: 'Inter', label: 'Inter', family: 'Inter', weight: 700, file: 'Inter-Bold.ttf' },
  { id: 'Poppins', label: 'Poppins', family: 'Poppins', weight: 700, file: 'Poppins-Bold.ttf' },
  {
    id: 'Poppins Black',
    label: 'Poppins Black',
    family: 'Poppins Black',
    weight: 900,
    file: 'Poppins-Black.ttf'
  },
  {
    id: 'Montserrat',
    label: 'Montserrat',
    family: 'Montserrat',
    weight: 700,
    file: 'Montserrat-Bold.ttf'
  },
  {
    id: 'Bebas Neue',
    label: 'Bebas Neue',
    family: 'Bebas Neue',
    weight: 400,
    file: 'BebasNeue-Regular.ttf'
  },
  { id: 'Oswald', label: 'Oswald', family: 'Oswald', weight: 700, file: 'Oswald-Bold.ttf' },
  { id: 'Anton', label: 'Anton', family: 'Anton', weight: 400, file: 'Anton-Regular.ttf' },
  { id: 'Archivo', label: 'Archivo', family: 'Archivo', weight: 700, file: 'Archivo-Bold.ttf' },
  { id: 'Roboto', label: 'Roboto', family: 'Roboto', weight: 700, file: 'Roboto-Bold.ttf' }
]

/** Applied to the caption text itself (not via CSS) so the preview and the FFmpeg export match exactly. */
export const applyTextCase = (text: string, textCase: TextCase): string =>
  textCase === 'upper' ? text.toUpperCase() : textCase === 'lower' ? text.toLowerCase() : text

export const DEFAULT_FONT_ID = 'Montserrat'

export const getFont = (id: string): FontOption =>
  FONTS.find((font) => font.id === id) ?? FONTS.find((font) => font.id === DEFAULT_FONT_ID)!
