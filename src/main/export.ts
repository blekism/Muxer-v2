import { execFile } from 'node:child_process'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join, parse } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type {
  ExportFailure,
  ExportJob,
  ExportProgress,
  ExportRequest,
  ExportResult,
  SourceEditSettings
} from '../shared/types'
import { TEMPERATURE_KELVIN, TEMPERATURE_MIX } from '../shared/colorConstants'
import { clampCopies } from '../shared/exportConstants'
import { MAX_FLASH_IMAGES } from '../shared/flashConstants'
import { pathExists } from './fileWatch'
import { ffmpegPath, ffprobePath } from './utils/ffpaths'

const runFile = promisify(execFile)
const FLASH_FRAMES = 3
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
  /** swscale matrix name for the source's YUV, e.g. bt709. */
  colorMatrix: string
  /** 'tv' (limited) or 'pc' (full). */
  colorRange: 'tv' | 'pc'
  colorTransfer: string | undefined
}

interface ProbeJson {
  streams?: Array<{
    codec_type?: string
    width?: number
    height?: number
    r_frame_rate?: string
    color_space?: string
    color_range?: string
    color_transfer?: string
  }>
  format?: { duration?: string }
}

/** ffprobe color_space -> swscale in_color_matrix name. */
const SWSCALE_MATRICES: Record<string, string> = {
  bt709: 'bt709',
  smpte170m: 'smpte170m',
  bt470bg: 'bt470',
  fcc: 'fcc',
  smpte240m: 'smpte240m',
  bt2020nc: 'bt2020',
  bt2020c: 'bt2020'
}
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])

/**
 * Color filters work in RGB, so FFmpeg converts YUV->RGB->YUV around them. Left to defaults, swscale uses BT.601
 * for untagged input and the output carries no tags, while Chromium (the preview) assumes BT.709. Both conversions
 * are explicit and the output is tagged BT.709 limited, so the export is decoded the same way the preview is.
 */
const OUTPUT_COLOR_ARGS = [
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_range',
  'tv'
]

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
    hasAudio: data.streams?.some((stream) => stream.codec_type === 'audio') ?? false,
    // Untagged sources are treated as BT.709 limited, which is what Chromium assumes.
    colorMatrix: SWSCALE_MATRICES[video.color_space ?? ''] ?? 'bt709',
    colorRange: video.color_range === 'pc' ? 'pc' : 'tv',
    colorTransfer: video.color_transfer
  }
}

function outputDimensions(width: number): { width: number; height: number } {
  const height = Math.max(2, Math.round((16 / 9) * width))
  return { width, height: height % 2 === 0 ? height : height + 1 }
}

/** value is the fraction of the width cut from each side of one edge (same unit as the UI slider). */
function perspectiveFilter(value: number, width: number, height: number): string | null {
  if (value === 0) return null
  const skew = Math.abs(value) * width
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
  const zoom = Math.max(1, settings.video.zoom)
  const portraitAspect = 9 / 16
  const textScale = output.width / 1080
  const fontSize = Math.max(1, Math.round(settings.text.size * textScale))
  const outlineWidth = Math.max(0, Math.round(settings.text.outline * textScale))
  const filters = [
    // Rotate the full frame first and crop afterwards. Rotating the already-cropped frame leaves black wedges
    // in its corners; the preview never shows them because the zoomed video fills the frame.
    `[0:v]setpts=PTS-STARTPTS,rotate=${settings.video.rotation}*PI/180:fillcolor=black,crop=min(iw\\,ih*${portraitAspect})/${zoom}:min(ih\\,iw/${portraitAspect})/${zoom}:(iw-ow)/2:(ih-oh)/2,scale=${output.width}:${output.height}`
  ]

  const perspective = perspectiveFilter(settings.video.perspective, output.width, output.height)
  if (perspective) filters[0] += `,${perspective}`
  // Explicit YUV->RGB with the source's own matrix and range (see OUTPUT_COLOR_ARGS).
  filters[0] += `,scale=in_color_matrix=${source.colorMatrix}:in_range=${source.colorRange},format=gbrp`
  if (settings.video.temperature !== TEMPERATURE_KELVIN.neutral) {
    // The stored value is already Kelvin, so it goes to FFmpeg unchanged.
    const temperature = Math.max(1000, Math.min(40000, settings.video.temperature))
    filters[0] += `,colortemperature=temperature=${temperature}:mix=${TEMPERATURE_MIX}`
  }
  // Tint is the shadow green lift (gs) in the same +-0.025 range spike2.mjs uses; positive = greener.
  if (settings.video.tint !== 0) filters[0] += `,colorbalance=gs=${settings.video.tint}`
  // Vignette is the lens angle in radians; larger = stronger, 0 = off.
  if (settings.video.vignette > 0) filters[0] += `,vignette=angle=${settings.video.vignette}`
  filters[0] += ',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[base]'

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
  onPercent: (percent: number) => void,
  signal: AbortSignal
): Promise<void> {
  const probe = await probeVideo(source.sourcePath, signal)
  if (probe.colorTransfer && HDR_TRANSFERS.has(probe.colorTransfer)) {
    console.warn(
      `[export] ${source.name} is HDR (${probe.colorTransfer}). It is not tone-mapped, so its colors will not match the preview.`
    )
  }
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
    'yuv420p',
    ...OUTPUT_COLOR_ARGS
  )

  if (music) {
    args.push('-map', `${musicInputIndex}:a:0`, '-c:a', 'aac', '-b:a', '192k')
  } else if (settings.audio.originalEnabled && probe.hasAudio) {
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k')
  } else {
    args.push('-an')
  }

  args.push('-t', String(durationSec), '-shortest', '-movflags', '+faststart', outputPath)

  // Machine-readable progress on stdout (key=value lines); stderr keeps the error output.
  args.unshift('-progress', 'pipe:1', '-nostats')

  try {
    await runFfmpegWithProgress(args, durationSec, onPercent, signal)
  } finally {
    if (captionPath) await unlink(captionPath).catch(() => undefined)
  }
}

/**
 * Runs ffmpeg like `runFile` would, and reports how far it is (0-99) from `-progress pipe:1` output.
 * 100 is left for the caller, once the file is actually finished.
 */
function runFfmpegWithProgress(
  args: string[],
  durationSec: number,
  onPercent: (percent: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      ffmpegPath,
      args,
      {
        windowsHide: true,
        maxBuffer: 50 * 1024 * 1024,
        timeout: EXPORT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        signal
      },
      (error) => (error ? reject(error) : resolve())
    )

    let pending = ''
    let lastPercent = -1
    child.stdout?.on('data', (chunk: Buffer | string) => {
      pending += chunk.toString()
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        // out_time_us is microseconds of output written so far ("N/A" before the first frame).
        const match = /^out_time_us=(\d+)$/.exec(line.trim())
        if (!match) continue
        const percent = Math.min(99, Math.floor((Number(match[1]) / 1e6 / durationSec) * 100))
        if (percent > lastPercent) {
          lastPercent = percent
          onPercent(percent)
        }
      }
    })
  })
}

/** Output files written by this session's exports; the only paths "Show in folder" will open. */
const exportedPaths = new Set<string>()

export function showExportedFile(filePath: string): void {
  if (typeof filePath === 'string' && exportedPaths.has(filePath)) shell.showItemInFolder(filePath)
}

/** Files a source's render reads besides the flash images: the video and its music track, if any. */
function sourceInputPaths(
  request: ExportRequest,
  source: ExportRequest['sources'][number]
): string[] {
  const musicId = request.sourceSettings[source.id]?.audio.musicId
  const music = request.music.find((track) => track.id === musicId)
  return music ? [source.sourcePath, music.sourcePath] : [source.sourcePath]
}

/** Every referenced input that no longer exists. Checked before the export starts. */
export async function findMissingInputs(request: ExportRequest): Promise<string[]> {
  const paths = new Set(request.sources.flatMap((source) => sourceInputPaths(request, source)))
  for (const imagePath of request.flashImagePaths) paths.add(imagePath)
  const list = [...paths]
  const exists = await Promise.all(list.map(pathExists))
  return list.filter((_, index) => !exists[index])
}

export async function exportVideos(
  request: ExportRequest,
  outputDirectory: string,
  onProgress: (progress: ExportProgress) => void,
  signal: AbortSignal
): Promise<ExportResult> {
  await mkdir(outputDirectory, { recursive: true })
  const images = request.flashImagePaths.slice(0, MAX_FLASH_IMAGES)
  const outputPaths: string[] = []
  const failures: ExportFailure[] = []

  const copies = clampCopies(request.copies)
  const fileNameFor = (source: ExportRequest['sources'][number], copy: number): string => {
    const baseName = `${parse(basename(source.sourcePath)).name}_edited`
    return copies === 1 ? `${baseName}.mp4` : `${baseName}_v${copy + 1}.mp4`
  }

  // Every output is listed up front (queued) so the progress panel shows the whole batch at once.
  const jobs: ExportJob[] = request.sources.flatMap((source) =>
    Array.from({ length: copies }, (_, copy) => ({
      id: `${source.id}:${copy}`,
      label: fileNameFor(source, copy),
      status: 'queued' as const,
      percent: 0
    }))
  )
  const emit = (): void => onProgress({ jobs: jobs.map((job) => ({ ...job })) })
  const update = (index: number, patch: Partial<ExportJob>): void => {
    jobs[index] = { ...jobs[index], ...patch }
    emit()
  }
  emit()

  let jobIndex = 0
  for (const source of request.sources) {
    const baseSettings = request.sourceSettings[source.id]
    if (!baseSettings) throw new Error(`Missing settings for ${source.name}`)

    for (let copy = 0; copy < copies; copy += 1, jobIndex += 1) {
      if (signal.aborted) throw new Error('Export cancelled')

      const settings: SourceEditSettings = {
        ...baseSettings,
        video: request.videoVariants?.[source.id]?.[copy] ?? baseSettings.video
      }
      const outputPath = await uniqueOutputPath(outputDirectory, fileNameFor(source, copy))
      const current = jobIndex
      // uniqueOutputPath may have added a -1 suffix; show the real name.
      update(current, { status: 'rendering', percent: 0, label: basename(outputPath) })
      try {
        await renderSource(
          request,
          source,
          settings,
          images,
          outputPath,
          (percent) => update(current, { percent }),
          signal
        )
        outputPaths.push(outputPath)
        exportedPaths.add(outputPath)
        update(current, { status: 'done', percent: 100, outputPath })
      } catch (error) {
        if (signal.aborted) throw error
        // A file deleted mid-export skips only this source; other errors still stop the batch.
        const inputs = sourceInputPaths(request, source)
        const exists = await Promise.all(inputs.map(pathExists))
        const missing = inputs.filter((_, i) => !exists[i])
        if (missing.length === 0) throw error

        // ffmpeg may have started writing before it failed.
        await unlink(outputPath).catch(() => undefined)
        const message = `File missing: ${missing.map((p) => basename(p)).join(', ')}`
        failures.push({ sourceName: source.name, error: message })
        // The file won't come back for the remaining copies, so skip them.
        for (let skipped = current; skipped < current + copies - copy; skipped += 1) {
          jobs[skipped] = { ...jobs[skipped], status: 'failed', error: message }
        }
        emit()
        jobIndex = current + copies - copy
        break
      }
    }
  }

  return { outputPaths, failures }
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
