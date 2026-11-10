import { useState } from 'react'
import type { ExportJob } from '../types'
import { Button, Icon, IconButton, cx } from './ui'

export type ExportRunState = 'running' | 'done' | 'cancelled' | 'error'

export interface ExportPanelState {
  jobs: ExportJob[]
  state: ExportRunState
}

interface ExportProgressPanelProps {
  progress: ExportPanelState
  onCancel: () => void
  onClose: () => void
  onShowFile: (filePath: string) => void
}

function headline({ jobs, state }: ExportPanelState): string {
  const total = jobs.length
  const done = jobs.filter((job) => job.status === 'done').length
  if (state === 'running') {
    if (total === 0) return 'Preparing export…'
    const current = Math.min(total, done + 1)
    return `Exporting ${current} of ${total}`
  }
  if (state === 'cancelled') return `Export cancelled · ${done} of ${total} done`
  if (done === total) return `${total} ${total === 1 ? 'video' : 'videos'} exported`
  return `Exported ${done} of ${total}`
}

/** Drive-style box in the lower right that lists every output file of the running export. */
export function ExportProgressPanel({
  progress,
  onCancel,
  onClose,
  onShowFile
}: ExportProgressPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { jobs, state } = progress
  const running = state === 'running'
  // Overall bar: each job counts equally, the active one by its own percent.
  const overall =
    jobs.length === 0
      ? 0
      : jobs.reduce((sum, job) => sum + (job.status === 'failed' ? 100 : job.percent), 0) /
        jobs.length

  return (
    <section
      className={cx('export-panel', collapsed && 'export-panel--collapsed')}
      aria-label="Export progress"
    >
      <header className="export-panel__head">
        <span className="export-panel__title" role="status" aria-live="polite">
          {headline(progress)}
        </span>
        <IconButton
          icon="chevron"
          label={collapsed ? 'Expand' : 'Collapse'}
          className={cx('export-panel__toggle', collapsed && 'export-panel__toggle--collapsed')}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        />
        {!running && <IconButton icon="close" label="Close" onClick={onClose} />}
      </header>

      {running && (
        <div className="export-panel__overall">
          <progress
            className="progress"
            value={overall}
            max={100}
            aria-label="Overall export progress"
          />
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}

      {!collapsed && jobs.length > 0 && (
        <ul className="export-panel__list">
          {jobs.map((job) => (
            <ExportRow key={job.id} job={job} onShowFile={onShowFile} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ExportRow({
  job,
  onShowFile
}: {
  job: ExportJob
  onShowFile: (filePath: string) => void
}) {
  return (
    <li className={cx('export-row', `export-row--${job.status}`)}>
      <span className="export-row__icon">
        <Icon
          name={
            job.status === 'done'
              ? 'check'
              : job.status === 'failed'
                ? 'warning'
                : job.status === 'rendering'
                  ? 'play'
                  : 'film'
          }
          size={14}
        />
      </span>
      <span className="export-row__body">
        <span className="export-row__name truncate" title={job.label}>
          {job.label}
        </span>
        {job.status === 'rendering' && (
          <progress
            className="progress"
            value={job.percent}
            max={100}
            aria-label={`${job.label} progress`}
          />
        )}
        {job.status === 'failed' && job.error && (
          <small className="export-row__error truncate" title={job.error}>
            {job.error}
          </small>
        )}
      </span>
      <span className="export-row__meta">
        {job.status === 'queued' && 'Waiting'}
        {job.status === 'rendering' && `${job.percent}%`}
        {job.status === 'done' && job.outputPath && (
          <IconButton
            icon="folder"
            label={`Show ${job.label} in folder`}
            onClick={() => job.outputPath && onShowFile(job.outputPath)}
          />
        )}
      </span>
    </li>
  )
}
