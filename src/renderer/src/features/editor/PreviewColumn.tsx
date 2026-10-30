import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { EmptyState, Icon } from '../../components/ui'
import type { HorizontalAlign, SourceEditSettings, SourceVideo, VerticalAlign } from '../../types'
import { fontStack } from './config'
import {
  PERSPECTIVE_CSS_DISTANCE,
  perspectiveToRotateXDeg,
  temperatureOverlayColor,
  tintToStrength,
  vignetteGradient
} from './previewMath'

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
  caption: string
  settings: SourceEditSettings
}

/**
 * Approximates the FFmpeg result with CSS so edits feel instant.
 * The exported file is still produced by FFmpeg, so treat this as a preview, not a pixel-exact render.
 */
export function PreviewColumn({ source, caption, settings }: PreviewColumnProps) {
  const { text, video } = settings
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [previewError, setPreviewError] = useState(false)

  useEffect(() => {
    const el = videoRef.current
    setIsPlaying(false)
    setPreviewError(false)
    if (el && el.readyState > 0) el.currentTime = video.trimStart
  }, [video.trimStart, source?.id])

  const togglePlayback = async () => {
    const el = videoRef.current
    if (!el) return

    if (el.paused) {
      await el.play()
    } else {
      el.pause()
    }
  }

  const videoStyle: CSSProperties = {
    // Same order as the FFmpeg chain: zoom, then rotate, then perspective.
    transform: `perspective(${PERSPECTIVE_CSS_DISTANCE}) rotateX(${perspectiveToRotateXDeg(video.perspective)}deg) rotate(${video.rotation}deg) scale(${video.zoom})`
  }

  // video.temperature is Kelvin (what FFmpeg gets). FFmpeg multiplies the picture by the black-body color,
  // so the overlay multiplies too instead of tinting on top.
  const temperatureStyle: CSSProperties = {
    background: temperatureOverlayColor(video.temperature),
    mixBlendMode: 'multiply'
  }
  // video.tint is FFmpeg's colorbalance green lift: positive = greener, negative = magenta.
  const tint = tintToStrength(video.tint)
  const tintStyle: CSSProperties = {
    background: tint >= 0 ? 'rgb(0 200 90)' : 'rgb(255 0 170)',
    // At the spike's +-0.025, FFmpeg only lifts deep shadows by about 3 of 255 levels, so keep this faint.
    opacity: Math.abs(tint) * 0.03
  }
  // video.vignette is FFmpeg's lens angle in radians; the gradient reproduces the filter's falloff.
  const vignetteStyle: CSSProperties = { background: vignetteGradient(video.vignette) }

  // Sizes use container query units so the caption scales with the preview frame.
  const toCqw = (px: number) => `${(px / REFERENCE_WIDTH) * 100}cqw`
  const captionStyle: CSSProperties = {
    fontFamily: fontStack(text.font),
    fontSize: toCqw(text.size),
    color: text.fill,
    textAlign: text.hAlign,
    // paint-order puts the stroke behind the fill, so only the outer half of it shows.
    WebkitTextStroke: `${toCqw(text.outline * 2)} ${text.outlineColor}`
  }

  return (
    <section className="preview" aria-label="Video preview">
      <div className="preview__stage">
        <div className="preview__frame">
          {source ? (
            <>
              {source.previewUrl && (
                <video
                  ref={videoRef}
                  key={source.id}
                  className="preview__video"
                  src={source.previewUrl}
                  style={videoStyle}
                  autoPlay
                  muted
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
                  }}
                />
              )}
              <div className="preview__overlay preview__overlay--blend" style={temperatureStyle} />
              <div className="preview__overlay preview__overlay--blend" style={tintStyle} />
              <div className="preview__overlay" style={vignetteStyle} />
              {previewError ? (
                <div className="preview__media-error" role="alert">
                  Unable to play this video.
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
                  <p className="preview__caption-text" style={captionStyle}>
                    {caption}
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
