import { useMemo } from 'react'
import { Navbar } from '../../components/Navbar'
import { EmptyState, Thumb } from '../../components/ui'
import { formatBytes, formatDuration, formatResolution, pluralize } from '../../lib/format'
import type { SourceVideo } from '../../types'

export function LibraryPage({ videos }: { videos: readonly SourceVideo[] }) {
  const totalBytes = useMemo(() => videos.reduce((sum, v) => sum + v.sizeBytes, 0), [videos])

  return (
    <>
      <Navbar title="Library" description="Where you browse your imported videos" />
      <div className="page page--library">
        <p className="muted">
          {pluralize(videos.length, 'video')} totaling {formatBytes(totalBytes)}
        </p>

        {videos.length === 0 ? (
          <EmptyState
            icon="film"
            title="Your library is empty"
            hint="Videos you import in the editor appear here."
          />
        ) : (
          <ul className="library-grid">
            {videos.map((video) => (
              <li key={video.id}>
                <article className="media-card">
                  <Thumb
                    src={video.thumbnailUrl}
                    alt={`Thumbnail of ${video.name}`}
                    className="media-card__thumb"
                  />
                  <div className="media-card__body">
                    <h2 className="truncate" title={video.name}>
                      {video.name}
                    </h2>
                    <dl className="media-card__meta">
                      <div>
                        <dt>Length</dt>
                        <dd>{formatDuration(video.durationSec)}</dd>
                      </div>
                      <div>
                        <dt>Size</dt>
                        <dd>{formatBytes(video.sizeBytes)}</dd>
                      </div>
                      <div>
                        <dt>Resolution</dt>
                        <dd>{formatResolution(video.width, video.height)}</dd>
                      </div>
                    </dl>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
