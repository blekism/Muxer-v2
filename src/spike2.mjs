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

for (const bin of [FFMPEG, FFPROBE]) {
  if (!existsSync(bin)) {
    console.error(`Binary not found: ${bin}`)
    process.exit(1)
  }
}

const { stdout: version } = await run(FFMPEG, ['-version'])
console.log(`Using: ${FFMPEG}`)
console.log(`${version.split('\n')[0]}\n`)

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

  const data = JSON.parse(stdout)
  const video = data.streams.find((stream) => stream.codec_type === 'video')

  if (!video) {
    throw new Error(`No video stream found in ${file}`)
  }

  const [numerator, denominator] = video.r_frame_rate.split('/').map(Number)

  const rotation =
    Math.abs(
      Number(
        video.tags?.rotate ??
          video.side_data_list?.find((sideData) => sideData.rotation !== undefined)?.rotation ??
          0
      )
    ) %
      180 ===
    90

  return {
    width: rotation ? video.height : video.width,
    height: rotation ? video.width : video.height,
    fps: numerator / denominator,
    durationSec: Number(data.format.duration),
    hasAudio: data.streams.some((stream) => stream.codec_type === 'audio')
  }
}

function makeFlashStarts(totalFrames, imageCount, flashFrames) {
  if (totalFrames < flashFrames) {
    throw new Error('Video is shorter than the image flash duration.')
  }

  const latestStart = totalFrames - flashFrames

  return Array.from({ length: imageCount }, () => Math.floor(Math.random() * (latestStart + 1)))
}

async function edit(input, flashImages, outFile) {
  const media = await probe(input)

  const speed = rand(0.85, 1.15)
  const brightness = rand(-0.08, 0.08)
  const contrast = rand(0.94, 1.08)
  const saturation = rand(0.9, 1.12)
  const zoom = rand(1.06, 1.18)
  const flip = Math.random() > 0.9

  const temperature = rand(4200, 6800)
  const temperatureMix = rand(0.25, 0.65)

  const redLift = rand(-0.025, 0.025)
  const greenLift = rand(-0.025, 0.025)
  const blueLift = rand(-0.025, 0.025)

  const vignetteAngle = rand(0.1, 0.2)

  const rotation = rand(-1.0, 1.0) // degrees
  const perspectiveX = rand(-0.005, 0.005)
  const perspectiveY = rand(-0.005, 0.005)

  // Each image appears for 3 frames.
  const flashFrames = 3

  const totalFrames = Math.floor((media.durationSec / speed) * media.fps)

  const flashStarts = makeFlashStarts(totalFrames, flashImages.length, flashFrames)

  const filters = [
    `[0:v]setpts=PTS/${speed},fps=${media.fps},` +
      `crop=iw/${zoom}:ih/${zoom},` +
      `scale=${media.width}:${media.height},` +
      `colortemperature=temperature=${temperature}:mix=${temperatureMix},` +
      `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation},` +
      `colorbalance=rs=${redLift}:gs=${greenLift}:bs=${blueLift},` +
      `vignette=angle=${vignetteAngle},` +
      `${flip ? 'hflip,' : ''}` +
      `format=yuv420p[base]`
  ]

  for (let index = 0; index < flashImages.length; index++) {
    const inputIndex = index + 1

    filters.push(
      `[${inputIndex}:v]` +
        `scale=${media.width}:${media.height}:` +
        `force_original_aspect_ratio=decrease,` +
        `pad=${media.width}:${media.height}:` +
        `(ow-iw)/2:(oh-ih)/2:color=black` +
        `[image${index}]`
    )
  }

  let previousVideo = '[base]'

  for (let index = 0; index < flashImages.length; index++) {
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

  if (media.hasAudio) {
    filters.push(`[0:a]atempo=${speed}[audio]`)
  }

  const args = [
    '-y',

    '-i',
    input,

    ...flashImages.flatMap((image) => ['-loop', '1', '-i', image]),

    '-filter_complex',
    filters.join(';'),

    '-map',
    previousVideo,

    ...(media.hasAudio ? ['-map', '[audio]'] : []),

    '-c:v',
    'libx264',
    '-crf',
    '23',
    '-preset',
    'fast',

    ...(media.hasAudio ? ['-c:a', 'aac'] : []),

    '-shortest',
    outFile
  ]

  const startedAt = Date.now()

  try {
    await run(FFMPEG, args, {
      maxBuffer: 1024 * 1024 * 50
    })
  } catch (error) {
    console.error(
      `FAIL ${path.basename(input)}\n` + `${error.stderr?.split('\n').slice(-8).join('\n')}\n`
    )
    return
  }

  const encodeSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)

  console.log(
    `OK ${path.basename(input)} ` +
      `images=${flashImages.length} ` +
      `flashFrames=${flashFrames} ` +
      `flashStarts=${flashStarts.join(',')} ` +
      `speed=${speed.toFixed(3)} ` +
      `brightness=${brightness.toFixed(3)} ` +
      `contrast=${contrast.toFixed(3)} ` +
      `saturation=${saturation.toFixed(3)} ` +
      `temperature=${temperature.toFixed(0)}K ` +
      `flip=${flip} ` +
      `encode=${encodeSeconds}s`
  )

  const output = await probe(outFile)
  const expectedDuration = media.durationSec / speed
  const problems = []

  if (Math.abs(output.durationSec - expectedDuration) > 0.5) {
    problems.push(
      `duration ${output.durationSec.toFixed(2)} ` +
        `vs approximately ${expectedDuration.toFixed(2)}`
    )
  }

  if (output.width !== media.width || output.height !== media.height) {
    problems.push('resolution changed')
  }

  if (media.hasAudio && !output.hasAudio) {
    problems.push('audio missing')
  }

  console.log(
    `${problems.length ? 'WARN' : 'OK'} ${path.basename(input)}` +
      (problems.length ? ` PROBLEMS: ${problems.join('; ')}` : '')
  )
}

// Usage:
// node spike.mjs image1.png image2.jpg image3.png -- video1.mp4 video2.mp4

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

for (const input of videoInputs) {
  const output = path.join(outDir, `${path.parse(input).name}_edited.mp4`)

  await edit(input, flashImages, output)
}
