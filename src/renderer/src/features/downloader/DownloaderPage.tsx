import { useId, useMemo, useState, type FormEvent, type JSX, type ReactNode } from 'react'
import { Navbar } from '../../components/Navbar'
import {
  Button,
  Checkbox,
  EmptyState,
  Icon,
  IconButton,
  Panel,
  Segmented,
  Thumb
} from '../../components/ui'
import { formatBytes, formatRelativeTime, pluralize } from '../../lib/format'
import { isTikTokUrl, parseLinks } from '../../lib/links'
import type { DownloadItem, DownloadMode, DownloadStatus } from '../../types'

export interface DownloaderPageProps {
  history: readonly DownloadItem[]
  onDownloadSingle: (url: string) => void
  onDownloadBatch: (urls: string[]) => void
  onShowInFolder: (id: string) => void
  onRetry: (id: string) => void
  onCancel: (id: string) => void
  /** Confirms with the user, then permanently deletes the videos. Resolves false if they cancelled. */
  onRemoveMany: (ids: string[]) => Promise<boolean>
  folder: string
  onChooseFolder: () => void
}

export function DownloaderPage({
  history,
  onDownloadSingle,
  onDownloadBatch,
  onShowInFolder,
  onRetry,
  onCancel,
  onRemoveMany,
  folder,
  onChooseFolder
}: DownloaderPageProps) {
  const toolbar = (
    <div className="dl-toolbar">
      <span className="muted truncate" title={folder}>
        Save to: {folder || '…'}
      </span>
      <Button size="sm" variant="ghost" icon="folder" onClick={onChooseFolder}>
        Change
      </Button>
    </div>
  )

  return (
    <>
      <Navbar title="Downloads" description="Where you download TikTok videos" />
      <div className="page page--downloader">
        <div className="downloader__top">
          <SingleDownload onSubmit={onDownloadSingle} />
          <BatchDownload onSubmit={onDownloadBatch} />
        </div>
        <History
          history={history}
          toolbar={toolbar}
          onShowInFolder={onShowInFolder}
          onRetry={onRetry}
          onCancel={onCancel}
          onRemoveMany={onRemoveMany}
        />
      </div>
    </>
  )
}

function SingleDownload({ onSubmit }: { onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState('')
  const inputId = useId()
  const errorId = useId()
  const trimmed = url.trim()
  const isValid = isTikTokUrl(trimmed)
  const showError = trimmed !== '' && !isValid

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isValid) return
    onSubmit(trimmed)
    setUrl('')
  }

  return (
    <Panel title="Single link">
      <form className="dl-form" onSubmit={handleSubmit} noValidate>
        <div className="dl-form__field">
          <label className="sr-only" htmlFor={inputId}>
            TikTok link
          </label>
          <input
            id={inputId}
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste a TikTok link"
            value={url}
            aria-invalid={showError}
            aria-describedby={showError ? errorId : undefined}
            onChange={(e) => setUrl(e.target.value)}
          />
          {showError && (
            <p id={errorId} className="field-error" role="alert">
              That doesn’t look like a TikTok link.
            </p>
          )}
        </div>
        <Button type="submit" variant="primary" icon="download" disabled={!isValid}>
          Download
        </Button>
      </form>
    </Panel>
  )
}

function BatchDownload({ onSubmit }: { onSubmit: (urls: string[]) => void }) {
  const [text, setText] = useState('')
  const inputId = useId()
  const { valid, invalid } = useMemo(() => parseLinks(text), [text])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (valid.length === 0) return
    onSubmit(valid)
    setText('')
  }

  const status =
    text.trim() === ''
      ? 'No links yet'
      : invalid > 0
        ? `${pluralize(valid.length, 'link')} ready, ${invalid} skipped`
        : `${pluralize(valid.length, 'link')} ready`

  return (
    <Panel
      title="Multiple links"
      actions={
        <p className="muted" aria-live="polite">
          {status}
        </p>
      }
    >
      <form className="dl-form dl-form--batch" onSubmit={handleSubmit}>
        <div className="dl-form__field">
          <label className="sr-only" htmlFor={inputId}>
            TikTok links, one per line
          </label>
          <textarea
            id={inputId}
            className="input"
            spellCheck={false}
            placeholder="Paste one link per line"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {/* <div className="dl-form__side"> */}
        <Button type="submit" variant="primary" icon="download" disabled={valid.length === 0}>
          Download all
        </Button>
        {/* </div> */}
      </form>
    </Panel>
  )
}

type HistoryFilter = 'all' | DownloadMode
const FILTERS: readonly { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'single', label: 'Single' },
  { value: 'batch', label: 'Batch' }
]

interface Selection {
  isSelected: (id: string) => boolean
  setSelected: (ids: readonly string[], selected: boolean) => void
}

type RowActions = Pick<DownloaderPageProps, 'onShowInFolder' | 'onRetry' | 'onCancel'> & {
  selection: Selection
}

interface HistoryProps
  extends Omit<RowActions, 'selection'>, Pick<DownloaderPageProps, 'onRemoveMany'> {
  history: readonly DownloadItem[]
  toolbar: ReactNode
}

type BatchEntry = { kind: 'batch'; key: string; createdAt: number; items: DownloadItem[] }
type HistoryEntry =
  { kind: 'item'; key: string; createdAt: number; item: DownloadItem } | BatchEntry

/** Collapses batch items into one entry per batch, newest first. Items keep their added order. */
function groupHistory(items: readonly DownloadItem[]): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  const batches = new Map<string, BatchEntry>()
  for (const item of items) {
    if (item.mode !== 'batch') {
      entries.push({ kind: 'item', key: item.id, createdAt: item.createdAt, item })
      continue
    }
    // Items saved before batchId existed share their batch's createdAt.
    const key = item.batchId ?? `batch-${item.createdAt}`
    let batch = batches.get(key)
    if (!batch) {
      batch = { kind: 'batch', key, createdAt: item.createdAt, items: [] }
      batches.set(key, batch)
      entries.push(batch)
    }
    batch.items.push(item)
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt)
}

function History({ history, toolbar, onRemoveMany, ...actions }: HistoryProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [selected, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [isDeleting, setIsDeleting] = useState(false)

  const visibleItems = useMemo(
    () => history.filter((item) => filter === 'all' || item.mode === filter),
    [history, filter]
  )
  const visible = useMemo(() => groupHistory(visibleItems), [visibleItems])
  // Only visible ids count, so hidden or already-removed items are never deleted.
  const selectedVisible = useMemo(
    () => visibleItems.filter((item) => selected.has(item.id)).map((item) => item.id),
    [visibleItems, selected]
  )

  const selection: Selection = {
    isSelected: (id) => selected.has(id),
    setSelected: (ids, on) =>
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const id of ids) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      })
  }

  const deleteSelected = async (): Promise<void> => {
    setIsDeleting(true)
    try {
      if (await onRemoveMany(selectedVisible)) setSelectedIds(new Set())
    } finally {
      setIsDeleting(false)
    }
  }

  const allSelected = visibleItems.length > 0 && selectedVisible.length === visibleItems.length

  const toggle = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <Panel
      title="Download history"
      bodyClassName="panel__body--flush"
      actions={
        <>
          {toolbar}
          <Button
            size="sm"
            variant="danger"
            icon="trash"
            disabled={selectedVisible.length === 0 || isDeleting}
            onClick={deleteSelected}
          >
            {selectedVisible.length === 0
              ? 'Delete'
              : `Delete ${pluralize(selectedVisible.length, 'video')}`}
          </Button>
          <Segmented
            legend="Show downloads"
            hideLegend
            options={FILTERS}
            value={filter}
            onChange={setFilter}
          />
        </>
      }
    >
      {visible.length === 0 ? (
        <EmptyState
          icon="download"
          title={history.length === 0 ? 'No downloads yet' : 'Nothing in this view'}
          hint={
            history.length === 0
              ? 'Videos you download will be listed here.'
              : 'Try a different filter.'
          }
        />
      ) : (
        <>
          <div className="history__selectbar">
            <Checkbox
              label="Select all downloads in this view"
              checked={allSelected}
              indeterminate={selectedVisible.length > 0 && !allSelected}
              onChange={(on) =>
                selection.setSelected(
                  visibleItems.map((item) => item.id),
                  on
                )
              }
            />
            <span className="muted" aria-live="polite">
              {selectedVisible.length > 0
                ? `${selectedVisible.length} selected`
                : 'Select downloads to delete'}
            </span>
            {selectedVisible.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            )}
          </div>
          <ul className="history">
            {visible.map((entry) =>
              entry.kind === 'item' ? (
                <HistoryRow key={entry.key} item={entry.item} selection={selection} {...actions} />
              ) : (
                <BatchGroup
                  key={entry.key}
                  items={entry.items}
                  createdAt={entry.createdAt}
                  expanded={expanded.has(entry.key)}
                  onToggle={() => toggle(entry.key)}
                  selection={selection}
                  {...actions}
                />
              )
            )}
          </ul>
        </>
      )}
      {history.length > 0 && (
        <p className="history__warning" role="note">
          <Icon name="warning" size={16} />
          Deleting a video here permanently deletes it from your device. This can’t be undone.
        </p>
      )}
    </Panel>
  )
}

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  done: 'Done',
  failed: 'Failed'
}

const isActiveStatus = (status: DownloadStatus): boolean =>
  status === 'queued' || status === 'downloading'

function BatchGroup({
  items,
  createdAt,
  expanded,
  onToggle,
  ...actions
}: {
  items: DownloadItem[]
  createdAt: number
  expanded: boolean
  onToggle: () => void
} & RowActions): JSX.Element {
  const bodyId = useId()
  const count = (status: DownloadStatus): number =>
    items.filter((item) => item.status === status).length
  const counts = {
    done: count('done'),
    downloading: count('downloading'),
    queued: count('queued'),
    failed: count('failed')
  }
  const activeCount = counts.downloading + counts.queued
  // Finished items (done or failed) count as complete, so the bar reaches the end.
  const progress =
    items.reduce(
      (sum, item) =>
        sum +
        (isActiveStatus(item.status) ? (item.status === 'downloading' ? item.progress : 0) : 100),
      0
    ) / items.length
  const totalBytes = items.reduce(
    (sum, item) => sum + (item.status === 'done' ? (item.sizeBytes ?? 0) : 0),
    0
  )
  const firstDone = items.find((item) => item.status === 'done')
  const label = `batch of ${pluralize(items.length, 'link')}`
  const summary = (['done', 'downloading', 'queued', 'failed'] as const)
    .filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${STATUS_LABEL[status].toLowerCase()}`)
    .join(' · ')

  const status =
    activeCount > 0
      ? { className: 'badge--downloading', text: `Downloading ${Math.round(progress)}%` }
      : counts.failed > 0
        ? { className: 'badge--failed', text: `${counts.failed} failed` }
        : { className: 'badge--done', text: 'Done' }

  const forEach =
    (predicate: (item: DownloadItem) => boolean, action: (id: string) => void) => (): void =>
      items.filter(predicate).forEach((item) => action(item.id))

  const ids = items.map((item) => item.id)
  const selectedCount = ids.filter(actions.selection.isSelected).length

  return (
    <li className="history__group">
      <div className="history__item history__group-head">
        <Checkbox
          label={`Select ${label}`}
          checked={selectedCount === items.length}
          indeterminate={selectedCount > 0 && selectedCount < items.length}
          onChange={(on) => actions.selection.setSelected(ids, on)}
        />
        <button
          type="button"
          className="history__group-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="history__group-chevron">
            <Icon name="chevron" size={18} />
          </span>
          <span className="history__main">
            <span className="history__title truncate">
              Batch · {pluralize(items.length, 'link')}
            </span>
            <span className="history__url truncate">{summary}</span>
            {activeCount > 0 && (
              <progress
                className="progress"
                value={progress}
                max={100}
                aria-label={`Downloading ${label}`}
              />
            )}
          </span>
        </button>
        <div className="history__meta">
          <div className="history__badges">
            <span className="badge">Batch</span>
            <span className={`badge ${status.className}`}>{status.text}</span>
          </div>
          <span className="muted">{totalBytes > 0 ? formatBytes(totalBytes) : '—'}</span>
          <span className="muted">•</span>
          <span className="muted">{formatRelativeTime(createdAt)}</span>
        </div>
        <div className="history__actions">
          {firstDone && (
            <IconButton
              icon="folder"
              label={`Show ${label} in folder`}
              onClick={() => actions.onShowInFolder(firstDone.id)}
            />
          )}
          {counts.failed > 0 && (
            <IconButton
              icon="retry"
              label={`Retry failed links in ${label}`}
              onClick={forEach((item) => item.status === 'failed', actions.onRetry)}
            />
          )}
          {activeCount > 0 && (
            <IconButton
              icon="close"
              label={`Cancel ${label}`}
              onClick={forEach((item) => isActiveStatus(item.status), actions.onCancel)}
            />
          )}
        </div>
      </div>
      <ul id={bodyId} className="history history__group-body" hidden={!expanded}>
        {items.map((item) => (
          <HistoryRow key={item.id} item={item} inGroup {...actions} />
        ))}
      </ul>
    </li>
  )
}

function HistoryRow({
  item,
  inGroup = false,
  onShowInFolder,
  onRetry,
  onCancel,
  selection
}: { item: DownloadItem; inGroup?: boolean } & RowActions) {
  const isActive = isActiveStatus(item.status)
  return (
    <li className="history__item">
      <Checkbox
        label={`Select ${item.title}`}
        checked={selection.isSelected(item.id)}
        onChange={(on) => selection.setSelected([item.id], on)}
      />
      <Thumb src={item.thumbnailUrl} className="history__thumb" />
      <div className="history__main">
        <p className="history__title truncate" title={item.title}>
          {item.title}
        </p>
        {item.status === 'failed' && item.error ? (
          <p className="history__url history__error truncate" title={item.error}>
            {item.error}
          </p>
        ) : (
          <p className="history__url truncate" title={item.url}>
            {item.url}
          </p>
        )}
        {item.status === 'downloading' && (
          <progress
            className="progress"
            value={item.progress}
            max={100}
            aria-label={`Downloading ${item.title}`}
          />
        )}
      </div>
      <div className="history__meta">
        <div className="history__badges">
          {!inGroup && <span className="badge">{item.mode === 'batch' ? 'Batch' : 'Single'}</span>}
          <span className={`badge badge--${item.status}`}>
            {STATUS_LABEL[item.status]}
            {item.status === 'downloading' && ` ${Math.round(item.progress)}%`}
          </span>
        </div>
        <span className="muted">{item.sizeBytes ? formatBytes(item.sizeBytes) : '—'}</span>
        <span className="muted">•</span>
        <span className="muted">{formatRelativeTime(item.createdAt)}</span>
      </div>
      <div className="history__actions">
        {item.status === 'done' && (
          <IconButton
            icon="folder"
            label={`Show ${item.title} in folder`}
            onClick={() => onShowInFolder(item.id)}
          />
        )}
        {item.status === 'failed' && (
          <IconButton icon="retry" label={`Retry ${item.title}`} onClick={() => onRetry(item.id)} />
        )}
        {isActive && (
          <IconButton
            icon="close"
            label={`Cancel ${item.title}`}
            onClick={() => onCancel(item.id)}
          />
        )}
      </div>
    </li>
  )
}
