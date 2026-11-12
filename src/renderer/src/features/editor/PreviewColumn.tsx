import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { EmptyState, Icon } from '../../components/ui'
import type {
  HorizontalAlign,
  MusicTrack,
  SourceEditSettings,
  SourceVideo,
  TextPosition,
  VerticalAlign
} from '../../types'
import { TEMPERATURE_KELVIN, fontStyle } from './config'
import { applyTextCase } from '../../../../shared/fonts'
import {
  PERSPECTIVE_CSS_DISTANCE,
  eqMatrix,
  isEqNeutral,
  perspectiveToRotateXDeg,
  temperatureMatrix,
  vignetteGradient
} from './previewMath'

const COLOR_FILTER_ID = 'preview-color-filter'
const REFERENCE_WIDTH = 1080 // export width the font size and outline are expressed in
const FLEX_ALIGN: Record<VerticalAlign | HorizontalAlign, CSSProperties['alignItems']> = {
  top: 'flex-start',
  left: 'flex-start',
  center: 'center',
  bottom: 'flex-end',
  right: 'flex-end'
}

interface PreviewColumnProps {
  source: SourceVideo | null
  /** The source file was deleted or moved since import. */
  missing: boolean
  caption: string
  settings: SourceEditSettings
  music: MusicTrack | null
  /** Called while the caption is dragged, with its new center as frame fractions. */
  onMoveText: (position: TextPosition) => void
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * Approximates the FFmpeg result with CSS so edits feel instant.
 * The exported file is still produced by FFmpeg, so treat this as a preview, not a pixel-exact render.
 */
export function PreviewColumn({
  source,
  missing,
  caption,
  settings,
  music,
  onMoveText
}: PreviewColumnProps) {
  const { text, video, audio } = settings
  const textPosition = text.position ?? null
  const frameRef = useRef<HTMLDivElement>(null)
  // Pointer offset from the caption's center, so the text doesn't jump when grabbed.
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [previewError, setPreviewError] = useState(false)

  // Like the export: selected music replaces the original audio, otherwise honour "Keep original audio".
  const musicUrl = music?.previewUrl
  const videoMuted = Boolean(musicUrl) || !audio.originalEnabled

  // Music follows the video's play state (it loops on its own, like `-stream_loop -1`).
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (isPlaying) el.play().catch((error) => console.error('[preview] music error', error))
    else el.pause()
  }, [isPlaying, musicUrl])

  useEffect(() => {
    const el = videoRef.current
    setIsPlaying(false)
    setPreviewError(false)
    if (el && el.readyState > 0) el.currentTime = video.trimStart
  }, [video.trimStart, source?.id, missing])

  // Speed: Chromium keeps the pitch by default, like FFmpeg's atempo.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.defaultPlaybackRate = video.speed
    el.playbackRate = video.speed
  }, [video.speed, source?.id, missing])

  const togglePlayback = async () => {
    const el = videoRef.current
    if (!el) return

    if (el.paused) {
      await el.play()
    } else {
      el.pause()
    }
  }

  // eq and temperature (Kelvin) are applied by one SVG filter, in FFmpeg's order.
  const hasColorFilter =
    !isEqNeutral(video.brightness, video.contrast, video.saturation) ||
    video.temperature !== TEMPERATURE_KELVIN.neutral
  const videoStyle: CSSProperties = {
    // Same order as the FFmpeg chain: zoom, then rotate, then perspective, then flip (CSS applies right to left).
    transform: `${video.flip ? 'scaleX(-1) ' : ''}perspective(${PERSPECTIVE_CSS_DISTANCE}) rotateX(${perspectiveToRotateXDeg(video.perspective)}deg) rotate(${video.rotation}deg) scale(${video.zoom})`,
    filter: hasColorFilter ? `url(#${COLOR_FILTER_ID})` : undefined
  }
  // video.vignette is FFmpeg's lens angle in radians; the gradient reproduces the filter's falloff.
  const vignetteStyle: CSSProperties = { background: vignetteGradient(video.vignette) }

  // Sizes use container query units so the caption scales with the preview frame.
  const toCqw = (px: number) => `${(px / REFERENCE_WIDTH) * 100}cqw`
  const captionStyle: CSSProperties = {
    ...fontStyle(text.font),
    fontSize: toCqw(text.size),
    color: text.fill,
    textAlign: text.hAlign,
    // paint-order puts the stroke behind the fill, so only the outer half of it shows.
    WebkitTextStroke: `${toCqw(text.outline * 2)} ${text.outlineColor}`,
    ...(textPosition && {
      position: 'absolute',
      left: `${textPosition.x * 100}%`,
      top: `${textPosition.y * 100}%`,
      transform: 'translate(-50%, -50%)',
      // Without this, the box shrinks toward the right edge and wraps early.
      width: 'max-content',
      maxWidth: 'calc(100% - 12cqw)'
    })
  }

  const onCaptionPointerDown = (event: PointerEvent<HTMLParagraphElement>): void => {
    if (event.button !== 0) return
    const box = event.currentTarget.getBoundingClientRect()
    dragRef.current = {
      dx: event.clientX - (box.left + box.width / 2),
      dy: event.clientY - (box.top + box.height / 2)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const onCaptionPointerMove = (event: PointerEvent<HTMLParagraphElement>): void => {
    const drag = dragRef.current
    const frame = frameRef.current
    if (!drag || !frame) return
    const frameBox = frame.getBoundingClientRect()
    const box = event.currentTarget.getBoundingClientRect()
    // Keep the whole text box inside the frame, like the export's clamp.
    const halfW = box.width / 2
    const halfH = box.height / 2
    const cx = clamp(event.clientX - drag.dx - frameBox.left, halfW, frameBox.width - halfW)
    const cy = clamp(event.clientY - drag.dy - frameBox.top, halfH, frameBox.height - halfH)
    onMoveText({ x: cx / frameBox.width, y: cy / frameBox.height })
  }

  const onCaptionPointerUp = (event: PointerEvent<HTMLParagraphElement>): void => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <section className="preview" aria-label="Video preview">
      <div className="preview__stage">
        <div className="preview__frame" ref={frameRef}>
          {source ? (
            <>
              {source.previewUrl && !missing && (
                <video
                  ref={videoRef}
                  key={source.id}
                  className="preview__video"
                  src={source.previewUrl}
                  style={videoStyle}
                  autoPlay
                  muted={videoMuted}
                  playsInline
                  onCanPlay={() => setPreviewError(false)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onError={(event) => {
                    const video = event.currentTarget
                    const error = video.error

                    console.error('[preview] video error', {
                      src: video.currentSrc,
                      code: error?.code,
                      message: error?.message,
                      networkState: video.networkState,
                      readyState: video.readyState
                    })

                    setPreviewError(true)
                  }}

                  onLoadStart={(event) => {
                    console.log('[preview] loading', event.currentTarget.currentSrc)
                  }}
                  onLoadedMetadata={(event) => {
                    console.log('[preview] metadata loaded', {
                      duration: event.currentTarget.duration,
                      videoWidth: event.currentTarget.videoWidth,
                      videoHeight: event.currentTarget.videoHeight
                    })

                    event.currentTarget.currentTime = video.trimStart
                  }}
                  onEnded={(event) => {
                    event.currentTarget.currentTime = video.trimStart
                    void event.currentTarget.play()
                    if (audioRef.current) audioRef.current.currentTime = 0
                  }}
                />
              )}
              {musicUrl && <audio ref={audioRef} src={musicUrl} loop />}
              <svg className="preview__filters" aria-hidden="true">
                {/* sRGB, not the linearRGB default: FFmpeg works on gamma-encoded 8-bit RGB. */}
                <filter id={COLOR_FILTER_ID} colorInterpolationFilters="sRGB">
                  <feColorMatrix
                    in="SourceGraphic"
                    type="matrix"
                    values={eqMatrix(video.brightness, video.contrast, video.saturation)}
                    result="equalized"
                  />
                  <feColorMatrix
                    in="equalized"
                    type="matrix"
                    values={temperatureMatrix(video.temperature)}
                  />
                </filter>
              </svg>
              <div className="preview__overlay" style={vignetteStyle} />
              {missing || previewError ? (
                <div className="preview__media-error" role="alert">
                  {missing ? 'Source file was moved or deleted.' : 'Unable to play this video.'}
                </div>
              ) : (
                <button
                  type="button"
                  className="preview__play"
                  aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
                  title={isPlaying ? 'Pause preview' : 'Play preview'}
                  onClick={togglePlayback}
                >
                  <Icon name={isPlaying ? 'pause' : 'play'} size={20} />
                </button>
              )}
              {caption && (
                <div
                  className="preview__caption"
                  style={{
                    justifyContent: FLEX_ALIGN[text.hAlign],
                    alignItems: FLEX_ALIGN[text.vAlign]
                  }}
                >
                  <p
                    className="preview__caption-text preview__caption-text--draggable"
                    style={captionStyle}
                    title="Drag to move"
                    onPointerDown={onCaptionPointerDown}
                    onPointerMove={onCaptionPointerMove}
                    onPointerUp={onCaptionPointerUp}
                    onPointerCancel={onCaptionPointerUp}
                  >
                    {applyTextCase(caption, text.textCase)}
                  </p>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon="film"
              title="Nothing to preview"
              hint="Import a source video to see your edits here."
            />
          )}
        </div>
      </div>
    </section>
  )
}
