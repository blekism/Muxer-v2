import { execFile } from 'node:child_process'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, parse } from 'node:path'
import { promisify } from 'node:util'
import type {
  ExportRequest,
  ExportResult,
  SourceEditSettings
} from '../shared/types'
import { ffmpegPath, ffprobePath } from './utils/ffpaths'

const runFile = promisify(execFile)
const FLASH_FRAMES = 3
const FLASH_IMAGE_COUNT = 5
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const OUTPUT_WIDTHS = { low: 480, medium: 720, high: 1080 } as const
const OUTPUT_CRFS = { low: 28, medium: 23, high: 18 } as const
const PROBE_TIMEOUT_MS = 60_000
const EXPORT_TIMEOUT_MS = 30 * 60_000

interface ProbeResult {
  width: number
  height: number
  fps: number
  durationSec: number
  hasAudio: boolean
}

interface ProbeJson {
  streams?: Array<{
    codec_type?: string
    width?: number
    height?: number
    r_frame_rate?: string
  }>
  format?: { duration?: string }
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function randomFlashStarts(totalFrames: number, imageCount: number): number[] {
  const flashFrames = Math.min(FLASH_FRAMES, totalFrames)
  if (flashFrames <= 0) return []

  const latestStart = Math.max(0, totalFrames - flashFrames)
  return Array.from({ length: imageCount }, () => Math.floor(Math.random() * (latestStart + 1)))
}

async function probeVideo(filePath: string, signal: AbortSignal): Promise<ProbeResult> {
  const { stdout } = await runFile(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
    { windowsHide: true, timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL', signal }
  )
  const data = JSON.parse(stdout) as ProbeJson
  const video = data.streams?.find((stream) => stream.codec_type === 'video')
  if (!video?.width || !video.height) throw new Error(`No video stream found in ${filePath}`)

  const [numerator, denominator] = (video.r_frame_rate ?? '30/1').split('/').map(Number)
  const durationSec = Number(data.format?.duration ?? 0)
  const fps = denominator > 0 ? numerator / denominator : 30

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`Video duration is invalid for ${filePath}`)
  }

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`Video frame rate is invalid for ${filePath}`)
  }

  return {
    width: video.width,
    height: video.height,
    fps,
    durationSec,
    hasAudio: data.streams?.some((stream) => stream.codec_type === 'audio') ?? false
  }
}

async function imagePaths(folderPath: string | null): Promise<string[]> {
  if (!folderPath) return []
  const entries = await readdir(folderPath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => join(folderPath, entry.name))
    .slice(0, FLASH_IMAGE_COUNT)
}

function outputDimensions(width: number): { width: number; height: number } {
  const height = Math.max(2, Math.round((16 / 9) * width))
  return { width, height: height % 2 === 0 ? height : height + 1 }
}

function perspectiveFilter(value: number, width: number, height: number): string | null {
  if (value === 0) return null
  const skew = (Math.abs(value) / 100) * width * 0.18
  const topLeft = value > 0 ? skew : 0
  const topRight = value > 0 ? width - skew : width
  const bottomLeft = value > 0 ? 0 : skew
  const bottomRight = value > 0 ? width : width - skew
  return `perspective=x0=${topLeft}:y0=0:x1=${topRight}:y1=0:x2=${bottomLeft}:y2=${height}:x3=${bottomRight}:y3=${height}:sense=source`
}

function buildFilters(
  source: ProbeResult,
  settings: SourceEditSettings,
  caption: string,
  images: string[],
  output: { width: number; height: number },
  captionPath: string | null
): { filters: string[]; finalLabel: string; starts: number[] } {
  const trimStart = Math.max(0, settings.video.trimStart)
  const remainingDuration = Math.max(0, source.durationSec - trimStart)
  const totalFrames = Math.floor(remainingDuration * source.fps)
  const starts = randomFlashStarts(totalFrames, images.length)
  const zoom = Math.max(1, settings.video.zoom / 100)
  const portraitAspect = 9 / 16
  const textScale = output.width / 1080
  const fontSize = Math.max(1, Math.round(settings.text.size * textScale))
  const outlineWidth = Math.max(0, Math.round(settings.text.outline * textScale))
  const filters = [
    `[0:v]setpts=PTS-STARTPTS,crop=min(iw\\,ih*${portraitAspect})/${zoom}:min(ih\\,iw/${portraitAspect})/${zoom}:(iw-ow)/2:(ih-oh)/2,rotate=${settings.video.rotation}*PI/180:fillcolor=black,scale=${output.width}:${output.height}`
  ]

  const perspective = perspectiveFilter(settings.video.perspective, output.width, output.height)
  if (perspective) filters[0] += `,${perspective}`
  if (settings.video.temperature !== 0) {
    const temperature = Math.max(1000, Math.min(40000, 6500 + settings.video.temperature * 20))
    filters[0] += `,colortemperature=temperature=${temperature}:mix=0.5`
  }
  if (settings.video.vignette > 0) filters[0] += ',vignette=angle=PI/4'
  filters[0] += ',format=yuv420p[base]'

  for (let index = 0; index < images.length; index += 1) {
    const inputIndex = index + 1
    filters.push(
      `[${inputIndex}:v]scale=${output.width}:${output.height}:force_original_aspect_ratio=decrease,pad=${output.width}:${output.height}:(ow-iw)/2:(oh-ih)/2:color=black[image${index}]`
    )
  }

  let previousLabel = '[base]'
  for (let index = 0; index < images.length; index += 1) {
    const start = starts[index]
    const end = start + Math.min(FLASH_FRAMES, totalFrames) - 1
    const outputLabel = `[flash${index}]`
    filters.push(
      `${previousLabel}[image${index}]overlay=shortest=1:enable='between(n,${start},${end})'${outputLabel}`
    )
    previousLabel = outputLabel
  }

  if (caption) {
    if (!captionPath) throw new Error('Caption path is required when caption text is present')
    filters.push(
      `${previousLabel}drawtext=textfile='${escapeFilterPath(captionPath)}':font='${escapeFilterValue(settings.text.font)}':fontsize=${fontSize}:fontcolor=${settings.text.fill}:bordercolor=${settings.text.outlineColor}:borderw=${outlineWidth}:x=${settings.text.hAlign === 'left' ? 'w*0.06' : settings.text.hAlign === 'right' ? 'w-text_w-w*0.06' : '(w-text_w)/2'}:y=${settings.text.vAlign === 'top' ? 'h*0.06' : settings.text.vAlign === 'bottom' ? 'h-text_h-h*0.06' : '(h-text_h)/2'}[captioned]`
    )
    return { filters, finalLabel: '[captioned]', starts }
  }

  return { filters, finalLabel: previousLabel, starts }
}

async function renderSource(
  request: ExportRequest,
  source: ExportRequest['sources'][number],
  settings: SourceEditSettings,
  images: string[],
  outputPath: string,
  signal: AbortSignal
): Promise<void> {
  const probe = await probeVideo(source.sourcePath, signal)
  const durationSec = probe.durationSec - Math.max(0, settings.video.trimStart)
  if (durationSec <= 0) {
    throw new Error(`Trim start is beyond the duration of ${source.name}`)
  }

  const output = outputDimensions(OUTPUT_WIDTHS[request.quality])
  const preset = request.presets.find((item) => item.id === settings.captionPresetId)
  const caption = preset?.text ?? ''
  const captionPath = caption
    ? join(process.env.TEMP ?? process.env.TMP ?? '.', `rstudio-caption-${crypto.randomUUID()}.txt`)
    : null

  if (captionPath) await writeFile(captionPath, caption, 'utf8')
  const { filters, finalLabel } = buildFilters(
    probe,
    settings,
    caption,
    images,
    output,
    captionPath
  )

  const music = request.music.find((track) => track.id === settings.audio.musicId)
  const musicInputIndex = 1 + images.length
  const args = ['-n', '-ss', String(Math.max(0, settings.video.trimStart)), '-i', source.sourcePath]
  for (const image of images) args.push('-loop', '1', '-i', image)
  if (music) args.push('-stream_loop', '-1', '-i', music.sourcePath)

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    finalLabel,
    '-c:v',
    'libx264',
    '-crf',
    String(OUTPUT_CRFS[request.quality]),
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p'
  )

  if (music) {
    args.push('-map', `${musicInputIndex}:a:0`, '-c:a', 'aac', '-b:a', '192k')
  } else if (settings.audio.originalEnabled && probe.hasAudio) {
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k')
  } else {
    args.push('-an')
  }

  args.push('-t', String(durationSec), '-shortest', '-movflags', '+faststart', outputPath)

  try {
    await runFile(ffmpegPath, args, {
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024,
      timeout: EXPORT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      signal
    })
  } finally {
    if (captionPath) await unlink(captionPath).catch(() => undefined)
  }
}

export async function exportVideos(
  request: ExportRequest,
  outputDirectory: string,
  onProgress: (progress: { completed: number; total: number; sourceName: string }) => void,
  signal: AbortSignal
): Promise<ExportResult> {
  await mkdir(outputDirectory, { recursive: true })
  // Old version: ExportRequest no longer carries a photo folder.
  const images = await imagePaths(null)
  const outputPaths: string[] = []

  for (let index = 0; index < request.sources.length; index += 1) {
    if (signal.aborted) throw new Error('Export cancelled')

    const source = request.sources[index]
    const settings = request.sourceSettings[source.id]
    if (!settings) throw new Error(`Missing settings for ${source.name}`)

    const outputPath = await uniqueOutputPath(
      outputDirectory,
      `${parse(basename(source.sourcePath)).name}_edited.mp4`
    )
    await renderSource(request, source, settings, images, outputPath, signal)
    outputPaths.push(outputPath)
    onProgress({ completed: index + 1, total: request.sources.length, sourceName: source.name })
  }

  return { outputPaths, failures: [] }
}

async function uniqueOutputPath(directory: string, fileName: string): Promise<string> {
  const parsed = parse(fileName)
  let suffix = 0

  while (true) {
    const candidate = join(
      directory,
      `${parsed.name}${suffix === 0 ? '' : `-${suffix}`}${parsed.ext}`
    )
    try {
      await stat(candidate)
      suffix += 1
    } catch {
      return candidate
    }
  }
}
