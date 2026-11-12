import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const binDir = path.join(here, 'resources', 'bin', 'win')

const outDir = path.join(here, 'out')
mkdirSync(outDir, { recursive: true })

const FFMPEG = process.env.FFMPEG_PATH ?? path.join(binDir, 'ffmpeg.exe')
const FFPROBE = process.env.FFPROBE_PATH ?? path.join(binDir, 'ffprobe.exe')

// fail loudly: no silent fallback to the system install
for (const bin of [FFMPEG, FFPROBE]) {
  if (!existsSync(bin)) {
    console.error(`Binary not found: ${bin}`)
    process.exit(1)
  }
}

// prove which binary is running
const { stdout: ver } = await run(FFMPEG, ['-version'])
console.log(`Using: ${FFMPEG}`)
console.log(ver.split('\n')[0] + '\n')

const rand = (min, max) => min + Math.random() * (max - min)

async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    file
  ])
  const j = JSON.parse(stdout)
  const v = j.streams.find((s) => s.codec_type === 'video')
  if (!v) {
    throw new Error(`No video stream found in ${file}`)
  }

  const [n, d] = v.r_frame_rate.split('/').map(Number)
  // phone videos often store rotation as metadata; ffmpeg auto-rotates,
  // so the real frame size is swapped for 90/270 degree clips
  const rot =
    Math.abs(
      Number(
        v.tags?.rotate ?? v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0
      )
    ) %
      180 ===
    90

  return {
    width: rot ? v.height : v.width,
    height: rot ? v.width : v.height,
    fps: n / d,
    durationSec: Number(j.format.duration),
    hasAudio: j.streams.some((s) => s.codec_type === 'audio')
  }
}

function makeFlashStarts(totalFrames, imageCount, flashFrames, fps) {
  const firstFlashFrame = Math.max(0, Math.round(fps * 2))
  const minimumGapFrames = Math.round(fps * 2)

  if (totalFrames < firstFlashFrame + flashFrames) {
    throw new Error('Video is shorter than the image flash duration.')
  }

  const latestStart = totalFrames - flashFrames
  const starts = []

  for (let index = 0; index < imageCount; index++) {
    const earliestStart = index === 0 ? firstFlashFrame : starts[index - 1] + minimumGapFrames

    if (earliestStart > latestStart) {
      throw new Error('Video is too short for all image flashes.')
    }

    // The first image should appear near the beginning, not anywhere after it.
    starts.push(
      index === 0
        ? firstFlashFrame
        : earliestStart + Math.floor(Math.random() * (latestStart - earliestStart + 1))
    )
  }

  return starts
}

async function edit(input, flashImg, outFile) {
  const m = await probe(input)

  // random properties (ranges are placeholders for the spike)
  const speed = rand(0.97, 1.03)
  const brightness = rand(-0.025, 0.025)
  const contrast = rand(0.98, 1.04)
  const saturation = rand(0.96, 1.06)

  const zoom = rand(1.02, 1.07)
  const flip = Math.random() > 0.5

  const colorTemperature = rand(5100, 5900)

  // Subtle RGB color-balance adjustments.
  // Shadows, midtones, and highlights respectively.
  const colorGrade = {
    shadowsRed: rand(-0.012, 0.012),
    shadowsGreen: rand(-0.01, 0.01),
    shadowsBlue: rand(-0.015, 0.015),

    midtonesRed: rand(-0.015, 0.02),
    midtonesGreen: rand(-0.01, 0.01),
    midtonesBlue: rand(-0.02, 0.01),

    highlightsRed: rand(-0.01, 0.015),
    highlightsGreen: rand(-0.01, 0.01),
    highlightsBlue: rand(-0.015, 0.01)
  }

  const vignetteAngle = rand(0.02, 0.08)

  const rotationDegrees = rand(-3, 3)
  const rotationRadians = rotationDegrees * (Math.PI / 180)

  // flash for 3 frames at a random spot, leaving room before the end
  // const flashFrames = 3;
  // const totalFrames = Math.floor((m.durationSec / speed) * m.fps);
  // const start = Math.floor(rand(0, Math.max(1, totalFrames - flashFrames)));
  // const end = start + flashFrames - 1;

  // Each image appears for 3 frames.
  const flashFrames = 3

  // Images must be at least 2 seconds apart.

  const totalFrames = Math.floor((m.durationSec / speed) * m.fps)

  const flashStarts = makeFlashStarts(totalFrames, flashImg.length, flashFrames, m.fps)

  const filters = [
    `[0:v]setpts=PTS/${speed},` +
      `eq=brightness=${brightness},` +
      `colortemperature=temperature=${colorTemperature}:mix=1,` +
      `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation},` +
      `colorbalance=` +
      `rs=${colorGrade.shadowsRed}:` +
      `gs=${colorGrade.shadowsGreen}:` +
      `bs=${colorGrade.shadowsBlue}:` +
      `rm=${colorGrade.midtonesRed}:` +
      `gm=${colorGrade.midtonesGreen}:` +
      `bm=${colorGrade.midtonesBlue}:` +
      `rh=${colorGrade.highlightsRed}:` +
      `gh=${colorGrade.highlightsGreen}:` +
      `bh=${colorGrade.highlightsBlue},` +
      `crop=iw/${zoom}:ih/${zoom},` +
      `scale=${m.width}:${m.height},` +
      `${flip ? 'hflip,' : ''}` +
      `vignette=angle=${vignetteAngle},` +
      `format=yuv420p[base]`
    // `rotate=${rotationRadians}:` +
    // `ow=rotw(iw):oh=roth(ih):fillcolor=black@0,` +

    // `[1:v]scale=${m.width}:${m.height}[img]`,

    // `[base][img]overlay=shortest=1:enable='between(n,${start},${end})'[v]`,
  ]

  for (let index = 0; index < flashImg.length; index++) {
    const inputIndex = index + 1

    filters.push(
      `[${inputIndex}:v]` +
        `scale=${m.width}:${m.height}:force_original_aspect_ratio=increase,` +
        `crop=${m.width}:${m.height}:(iw-ow)/2:(ih-oh)/2` +
        `[image${index}]`
    )
  }

  let previousVideo = '[base]'

  for (let index = 0; index < flashImg.length; index++) {
    const start = flashStarts[index]
    const end = start + flashFrames - 1
    const outputLabel = `[video${index}]`

    filters.push(
      `${previousVideo}[image${index}]` +
        `overlay=shortest=1:` +
        `enable='between(n,${start},${end})'` +
        outputLabel
    )

    previousVideo = outputLabel
  }

  if (m.hasAudio) filters.push(`[0:a]atempo=${speed}[a]`)

  const args = [
    '-y',
    '-i',
    input,

    ...flashImg.flatMap((image) => ['-loop', '1', '-i', image]),

    '-filter_complex',
    filters.join(';'),

    '-map',
    previousVideo,
    ...(m.hasAudio ? ['-map', '[a]'] : []),

    '-c:v',
    'libx264',
    '-crf',
    '23',
    '-preset',
    'fast',

    ...(m.hasAudio ? ['-c:a', 'aac'] : []),

    '-shortest',
    outFile
  ]

  const t0 = Date.now()
  try {
    await run(FFMPEG, args, { maxBuffer: 1024 * 1024 * 50 })
  } catch (e) {
    console.log(`FAIL ${path.basename(input)}\n${e.stderr}\n`)
    return
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)

  // verify the output
  const o = await probe(outFile)
  const expected = m.durationSec / speed
  const problems = []
  if (Math.abs(o.durationSec - expected) > 0.5)
    problems.push(`duration ${o.durationSec.toFixed(2)} vs ~${expected.toFixed(2)}`)
  if (o.width !== m.width || o.height !== m.height) problems.push('resolution changed')
  if (m.hasAudio && !o.hasAudio) problems.push('audio missing')

  console.log(
    `${problems.length ? 'WARN' : 'OK  '}  ${path.basename(input)}  ` +
      `images=${flashImg.length} ` +
      `flashFrames=${flashFrames} ` +
      `flashStarts=${flashStarts.join(',')} ` +
      `speed=${speed.toFixed(3)} ` +
      `brightness=${brightness.toFixed(3)} ` +
      `contrast=${contrast.toFixed(3)} ` +
      `saturation=${saturation.toFixed(3)} ` +
      `temperature=${colorTemperature.toFixed(0)}K ` +
      `flip=${flip} ` +
      `encode=${secs}s`,
    `fps=${m.fps}`,
    problems.length ? `  PROBLEMS: ${problems.join('; ')}` : ''
  )
}

const commandArgs = process.argv.slice(2)
const separatorIndex = commandArgs.indexOf('--')

if (separatorIndex === -1) {
  console.error('Usage: node spike.mjs image1.png image2.jpg -- video1.mp4 video2.mp4')
  process.exit(1)
}

const flashImages = commandArgs.slice(0, separatorIndex)
const videoInputs = commandArgs.slice(separatorIndex + 1)

if (!flashImages.length) {
  console.error('Provide at least one flash image.')
  process.exit(1)
}

if (!videoInputs.length) {
  console.error('Provide at least one video.')
  process.exit(1)
}

// for (const input of videoInputs) {
//   const output = path.join(outDir, `${path.parse(input).name}_edited.mp4`);

//   await edit(input, flashImages, output);
// }

const variantCount = 4

for (const input of videoInputs) {
  const baseName = path.parse(input).name

  for (let variant = 1; variant <= variantCount; variant++) {
    const output = path.join(outDir, `${baseName}_edited_${variant}.mp4`)

    await edit(input, flashImages, output)
  }
}

// const [flashImg, ...inputs] = process.argv.slice(2);
// for (const input of inputs) {
//   await edit(
//     input,
//     flashImg,
//     path.join("out", `${path.parse(input).name}_edited.mp4`),
//   );
// }
