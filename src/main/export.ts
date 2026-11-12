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
import { applyTextCase } from '../shared/fonts'
import { MAX_FLASH_IMAGES, clampFlashRepeats } from '../shared/flashConstants'
import { pathExists } from './fileWatch'
import { ffmpegPath, ffprobePath, fontFilePath } from './utils/ffpaths'

const runFile = promisify(execFile)
const FLASH_FRAMES = 3
/** No flash starts before this frame. */
const FIRST_FLASH_FRAME = 60
/** Minimum spacing between flashes (spike2.mjs uses 2 seconds). */
const MIN_FLASH_GAP_SEC = 2
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

function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/**
 * `count` sorted, random flash start frames, none before FIRST_FLASH_FRAME and at least MIN_FLASH_GAP_SEC apart
 * (the gap shrinks on short clips, but never so far that flashes overlap). Uniform over the clip: random offsets
 * in the range left after reserving the gaps, sorted, then pushed apart by i * gap.
 */
function flashStarts(totalFrames: number, count: number, fps: number, speed: number): number[] {
  if (count <= 0) return []
  // Starts are source frame numbers (overlay's `n`). The output is resampled to a constant fps after the speed
  // change, so output frame 60 is source frame 60 * speed (and 2 output seconds are 2 * fps * speed frames).
  const firstFrame = Math.ceil(FIRST_FLASH_FRAME * speed)
  const span = totalFrames - FLASH_FRAMES - firstFrame
  const preferredGap = Math.max(FLASH_FRAMES, Math.round(MIN_FLASH_GAP_SEC * fps * speed))
  const gap = count > 1 ? Math.min(preferredGap, Math.floor(span / (count - 1))) : 0
  if (span < 0 || (count > 1 && gap < FLASH_FRAMES)) {
    throw new Error(
      `Video is too short for ${count} image flash${count === 1 ? '' : 'es'} after frame ${FIRST_FLASH_FRAME}`
    )
  }

  const free = span - (count - 1) * gap
  return Array.from({ length: count }, () => Math.floor(Math.random() * (free + 1)))
    .sort((a, b) => a - b)
    .map((offset, index) => firstFrame + offset + index * gap)
}

/** Fisher-Yates shuffle (copy). */
function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
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

/** Speed multiplier kept inside atempo's 0.5..2 range; anything invalid plays at normal speed. */
function clampSpeed(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.min(2, Math.max(0.5, value))
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

/** drawtext x/y: a dragged center position (clamped inside the frame), else the 6% inset anchors. */
function captionXY(text: SourceEditSettings['text']): { x: string; y: string } {
  const position = text.position ?? null
  if (position) {
    return {
      x: `max(0\\,min(w-text_w\\,w*${position.x}-text_w/2))`,
      y: `max(0\\,min(h-text_h\\,h*${position.y}-text_h/2))`
    }
  }
  return {
    x:
      text.hAlign === 'left' ? 'w*0.06' : text.hAlign === 'right' ? 'w-text_w-w*0.06' : '(w-text_w)/2',
    y:
      text.vAlign === 'top' ? 'h*0.06' : text.vAlign === 'bottom' ? 'h-text_h-h*0.06' : '(h-text_h)/2'
  }
}

function buildFilters(
  source: ProbeResult,
  settings: SourceEditSettings,
  caption: string,
  images: string[],
  repeats: number,
  output: { width: number; height: number },
  captionPath: string | null
): { filters: string[]; finalLabel: string; starts: number[] } {
  const { video } = settings
  const speed = clampSpeed(video.speed)
  const trimStart = Math.max(0, video.trimStart)
  // setpts only changes timestamps, so the frame count (what overlay's `n` counts) ignores speed.
  const totalFrames = Math.floor(Math.max(0, source.durationSec - trimStart) * source.fps)
  // Every repeat is its own flash (like passing the image twice to spike2.mjs): each gets its own random slot,
  // and the slots are dealt to the images in random order.
  const occurrences = shuffled(
    images.flatMap((_, image) => Array.from({ length: repeats }, (_, copy) => ({ image, copy })))
  )
  const starts = flashStarts(totalFrames, occurrences.length, source.fps, speed)
  const zoom = Math.max(1, settings.video.zoom)
  const portraitAspect = 9 / 16
  const textScale = output.width / 1080
  const fontSize = Math.max(1, Math.round(settings.text.size * textScale))
  const outlineWidth = Math.max(0, Math.round(settings.text.outline * textScale))
  const filters = [
    // Rotate the full frame first and crop afterwards. Rotating the already-cropped frame leaves black wedges
    // in its corners; the preview never shows them because the zoomed video fills the frame.
    `[0:v]setpts=(PTS-STARTPTS)/${speed},rotate=${video.rotation}*PI/180:fillcolor=black,crop=min(iw\\,ih*${portraitAspect})/${zoom}:min(ih\\,iw/${portraitAspect})/${zoom}:(iw-ow)/2:(ih-oh)/2,scale=${output.width}:${output.height}`
  ]

  const perspective = perspectiveFilter(video.perspective, output.width, output.height)
  if (perspective) filters[0] += `,${perspective}`
  if (video.flip) filters[0] += ',hflip'
  // eq only accepts YUV, so it runs before the RGB conversion. Contrast/brightness act on luma, saturation on chroma.
  if (video.brightness !== 0 || video.contrast !== 1 || video.saturation !== 1) {
    filters[0] += `,eq=brightness=${video.brightness}:contrast=${video.contrast}:saturation=${video.saturation}`
  }
  // Explicit YUV->RGB with the source's own matrix and range (see OUTPUT_COLOR_ARGS).
  filters[0] += `,scale=in_color_matrix=${source.colorMatrix}:in_range=${source.colorRange},format=gbrp`
  if (video.temperature !== TEMPERATURE_KELVIN.neutral) {
    // The stored value is already Kelvin, so it goes to FFmpeg unchanged.
    const temperature = Math.max(1000, Math.min(40000, video.temperature))
    filters[0] += `,colortemperature=temperature=${temperature}:mix=${TEMPERATURE_MIX}`
  }
  // Vignette is the lens angle in radians; larger = stronger, 0 = off.
  if (video.vignette > 0) filters[0] += `,vignette=angle=${video.vignette}`
  filters[0] += ',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[base]'

  // One decoded input per image, split into one stream per repeat so each flash has its own overlay.
  for (let index = 0; index < images.length; index += 1) {
    const inputIndex = index + 1
    const copies = Array.from({ length: repeats }, (_, copy) => `[image${index}_${copy}]`).join('')
    filters.push(
      `[${inputIndex}:v]scale=${output.width}:${output.height}:force_original_aspect_ratio=increase,crop=${output.width}:${output.height},setsar=1,split=${repeats}${copies}`
    )
  }

  // Overlays are chained in time order, one per flash.
  let previousLabel = '[base]'
  const flashWindows: string[] = []
  occurrences.forEach(({ image, copy }, slot) => {
    const start = starts[slot]
    const window = `between(n,${start},${start + FLASH_FRAMES - 1})`
    flashWindows.push(window)
    const outputLabel = `[flash${slot}]`
    filters.push(
      `${previousLabel}[image${image}_${copy}]overlay=shortest=1:enable='${window}'${outputLabel}`
    )
    previousLabel = outputLabel
  })

  if (caption) {
    if (!captionPath) throw new Error('Caption path is required when caption text is present')
    const { x, y } = captionXY(settings.text)
    // Hide the caption on the flash frames so the photo shows without text over it.
    const enable = flashWindows.length > 0 ? `:enable='not(${flashWindows.join('+')})'` : ''
    filters.push(
      `${previousLabel}drawtext=textfile='${escapeFilterPath(captionPath)}':fontfile='${escapeFilterPath(fontFilePath(settings.text.font))}':fontsize=${fontSize}:fontcolor=${settings.text.fill}:bordercolor=${settings.text.outlineColor}:borderw=${outlineWidth}:x=${x}:y=${y}${enable}[captioned]`
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
  const speed = clampSpeed(settings.video.speed)
  const sourceDurationSec = probe.durationSec - Math.max(0, settings.video.trimStart)
  if (sourceDurationSec <= 0) {
    throw new Error(`Trim start is beyond the duration of ${source.name}`)
  }
  // Output length after the speed change (setpts / atempo).
  const durationSec = sourceDurationSec / speed

  const output = outputDimensions(OUTPUT_WIDTHS[request.quality])
  const preset = request.presets.find((item) => item.id === settings.captionPresetId)
  const caption = applyTextCase(preset?.text ?? '', settings.text.textCase)
  const captionPath = caption
    ? join(process.env.TEMP ?? process.env.TMP ?? '.', `rstudio-caption-${crypto.randomUUID()}.txt`)
    : null

  // Built before the caption file is written, so a too-short clip doesn't leave a temp file behind.
  const { filters, finalLabel } = buildFilters(
    probe,
    settings,
    caption,
    images,
    clampFlashRepeats(request.flashRepeats),
    output,
    captionPath
  )
  if (captionPath) await writeFile(captionPath, caption, 'utf8')

  const music = request.music.find((track) => track.id === settings.audio.musicId)
  const musicInputIndex = 1 + images.length
  const args = ['-n', '-ss', String(Math.max(0, settings.video.trimStart)), '-i', source.sourcePath]
  for (const image of images) args.push('-loop', '1', '-i', image)
  if (music) args.push('-stream_loop', '-1', '-i', music.sourcePath)

  // Original audio follows the video speed; music is left at its own tempo.
  const keepOriginalAudio = !music && settings.audio.originalEnabled && probe.hasAudio
  const retimeAudio = keepOriginalAudio && speed !== 1
  if (retimeAudio) filters.push(`[0:a:0]atempo=${speed}[retimed]`)

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
  } else if (keepOriginalAudio) {
    args.push('-map', retimeAudio ? '[retimed]' : '0:a:0?', '-c:a', 'aac', '-b:a', '192k')
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
        failures.push({ sourceId: source.id, sourceName: source.name, error: message })
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
