import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { EmptyState, Icon } from '../../components/ui'
import type { HorizontalAlign, SourceEditSettings, SourceVideo, VerticalAlign } from '../../types'
import { fontStack } from './config'

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
    transform: `perspective(900px) rotateY(${video.perspective}deg) rotate(${video.rotation}deg) scale(${video.zoom / 100})`
  }

  const temperatureStyle: CSSProperties = {
    background: video.temperature >= 0 ? 'rgb(255 150 50)' : 'rgb(60 140 255)',
    opacity: (Math.abs(video.temperature) / 100) * 0.4
  }
  const tintStyle: CSSProperties = {
    background: video.tint >= 0 ? 'rgb(255 0 170)' : 'rgb(0 200 90)',
    opacity: (Math.abs(video.tint) / 100) * 0.35
  }
  const vignetteStyle: CSSProperties = {
    background: `radial-gradient(ellipse at center, transparent 55%, rgb(0 0 0 / ${(video.vignette / 100) * 0.85}) 100%)`
  }

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
