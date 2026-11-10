import { FONTS } from '../../shared/fonts'

// The same .ttf files FFmpeg uses for the export, so the preview matches it.
const fontUrls = import.meta.glob('../../../resources/fonts/*.ttf', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

export function loadFonts(): void {
  for (const font of FONTS) {
    if (!font.file) continue
    const url = Object.entries(fontUrls).find(([path]) => path.endsWith(`/${font.file}`))?.[1]
    if (!url) continue
    const face = new FontFace(font.family, `url("${url}")`, { weight: String(font.weight) })
    document.fonts.add(face)
    void face.load().catch(() => undefined)
  }
}
