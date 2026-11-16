import { useEffect, useId, useState, type FormEvent } from 'react'
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  Panel,
  RadioList,
  Thumb,
  cx
} from '../../components/ui'
import { formatDuration, pluralize } from '../../lib/format'
import type { CaptionPreset, FlashImage, SourceVideo } from '../../types'
import {
  MAX_FLASH_REPEATS,
  MAX_POOL_IMAGES,
  MIN_FLASH_REPEATS,
  clampFlashRepeats
} from '../../../../shared/flashConstants'

interface MediaColumnProps {
  flashImages: readonly FlashImage[]
  selectedFlashIds: readonly string[]
  flashNotice: string | null
  flashRepeats: number
  onChangeFlashRepeats: (value: number) => void
  missingPaths: ReadonlySet<string>
  sources: readonly SourceVideo[]
  activeSourceId: string | null
  presets: readonly CaptionPreset[]
  activePresetId: string | null
  onPickFlashImages: () => void
  onRemoveFlashImage: (id: string) => void
  onToggleFlashImage: (id: string) => void
  onImportVideos: () => void
  onSelectSource: (id: string) => void
  onRemoveSource: (id: string) => void
  onRemoveAllSources: () => void
  onSelectPreset: (id: string | null) => void
  onAddPreset: (text: string) => void
  onDeletePreset: (id: string) => void
  syncCaption: boolean
  onToggleSyncCaption: (enabled: boolean) => void
}

export function MediaColumn(props: MediaColumnProps) {
  return (
    <div className="editor__col editor__col--media">
      <PhotosPanel
        images={props.flashImages}
        selectedIds={props.selectedFlashIds}
        notice={props.flashNotice}
        repeats={props.flashRepeats}
        onChangeRepeats={props.onChangeFlashRepeats}
        missingPaths={props.missingPaths}
        onPick={props.onPickFlashImages}
        onRemove={props.onRemoveFlashImage}
        onToggle={props.onToggleFlashImage}
      />
      <SourcesPanel
        sources={props.sources}
        missingPaths={props.missingPaths}
        activeId={props.activeSourceId}
        onImport={props.onImportVideos}
        onSelect={props.onSelectSource}
        onRemove={props.onRemoveSource}
        onRemoveAll={props.onRemoveAllSources}
      />
      <CaptionsPanel
        presets={props.presets}
        activeId={props.activePresetId}
        onSelect={props.onSelectPreset}
        onAdd={props.onAddPreset}
        onDelete={props.onDeletePreset}
        syncCaption={props.syncCaption}
        onToggleSync={props.onToggleSyncCaption}
        disabled={props.sources.length === 0}
      />
    </div>
  )
}

function PhotosPanel({
  images,
  selectedIds,
  notice,
  repeats,
  onChangeRepeats,
  missingPaths,
  onPick,
  onRemove,
  onToggle
}: {
  images: readonly FlashImage[]
  selectedIds: readonly string[]
  notice: string | null
  repeats: number
  onChangeRepeats: (value: number) => void
  missingPaths: ReadonlySet<string>
  onPick: () => void
  onRemove: (id: string) => void
  onToggle: (id: string) => void
}) {
  const missingCount = images.filter((image) => missingPaths.has(image.path)).length
  const selectedCount = images.filter((image) => selectedIds.includes(image.id)).length
  return (
    <Panel
      title="Flash images"
      actions={
        <Button size="sm" icon="plus" onClick={onPick}>
          Add images
        </Button>
      }
    >
      {images.length > 0 ? (
        <>
          <div className="folder-info">
            <span className="muted">
              {selectedCount > 0 ? '1 selected' : 'None selected'} · {images.length} /{' '}
              {MAX_POOL_IMAGES} images
            </span>
            {missingCount > 0 && (
              <span className="missing-label">{pluralize(missingCount, 'image')} missing</span>
            )}
            {notice && <span className="muted">{notice}</span>}
          </div>
          <ul className="thumb-grid">
            {images.map((image) => {
              const selected = selectedIds.includes(image.id)
              const missing = missingPaths.has(image.path)
              return (
                <li
                  key={image.id}
                  className={cx(
                    'thumb-grid__item',
                    selected && 'thumb-grid__item--selected',
                    missing && 'thumb-grid__item--missing'
                  )}
                >
                  <button
                    type="button"
                    className="thumb-grid__select"
                    aria-pressed={selected}
                    aria-label={`${selected ? 'Deselect' : 'Select'} ${image.name}`}
                    title={missing ? `${image.name} (missing)` : image.name}
                    onClick={() => onToggle(image.id)}
                  >
                    <Thumb src={image.url} alt="" />
                    {selected && (
                      <span className="thumb-grid__check" aria-hidden="true">
                        <Icon name="check" size={12} />
                      </span>
                    )}
                  </button>
                  <IconButton
                    icon="close"
                    label={`Remove ${image.name}`}
                    className="thumb-grid__remove"
                    onClick={() => onRemove(image.id)}
                  />
                </li>
              )
            })}
          </ul>
          <p className="field-hint">
            {selectedCount === 0
              ? 'No image selected, so nothing will flash. Click an image to choose the one that flashes.'
              : 'Click another image to flash it instead, or click the selected one to clear it.'}
          </p>
          <FlashRepeatsField value={repeats} onChange={onChangeRepeats} />
        </>
      ) : (
        <EmptyState
          icon="image"
          title="No images yet"
          hint={`Add up to ${MAX_POOL_IMAGES} images, then select one to flash at random points in the video.`}
        />
      )}
    </Panel>
  )
}

function FlashRepeatsField({
  value,
  onChange
}: {
  value: number
  onChange: (value: number) => void
}) {
  const id = useId()
  // Never blank: an empty, invalid or out-of-range entry snaps back into range.
  const shown = clampFlashRepeats(value)

  return (
    <div className="field copies-field">
      <label className="field-label" htmlFor={id}>
        Flashes per video
      </label>
      <input
        id={id}
        className="input"
        type="number"
        inputMode="numeric"
        min={MIN_FLASH_REPEATS}
        max={MAX_FLASH_REPEATS}
        step={1}
        value={shown}
        // Select on focus so typing a digit replaces the value instead of appending to it.
        onFocus={(event) => event.target.select()}
        onChange={(event) =>
          onChange(
            event.target.value.trim() === '' ? MIN_FLASH_REPEATS : Number(event.target.value)
          )
        }
      />
      <p className="field-hint">
        The selected image flashes {pluralize(shown, 'time')} at random points in the video.
      </p>
    </div>
  )
}

interface SourcesPanelProps {
  sources: readonly SourceVideo[]
  missingPaths: ReadonlySet<string>
  activeId: string | null
  onImport: () => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onRemoveAll: () => void
}

/** How long the "Remove all" button waits for its confirming second click. */
const CONFIRM_REMOVE_ALL_MS = 4000

function SourcesPanel({
  sources,
  missingPaths,
  activeId,
  onImport,
  onSelect,
  onRemove,
  onRemoveAll
}: SourcesPanelProps) {
  // Removing every video takes two clicks: the first arms the button, the second removes.
  const [confirmingRemoveAll, setConfirmingRemoveAll] = useState(false)
  useEffect(() => {
    if (!confirmingRemoveAll) return
    const timer = window.setTimeout(() => setConfirmingRemoveAll(false), CONFIRM_REMOVE_ALL_MS)
    return () => window.clearTimeout(timer)
  }, [confirmingRemoveAll])

  return (
    <Panel
      title="Source videos"
      actions={
        <>
          {sources.length > 0 &&
            (confirmingRemoveAll ? (
              <Button
                size="sm"
                variant="danger"
                icon="trash"
                onClick={() => {
                  setConfirmingRemoveAll(false)
                  onRemoveAll()
                }}
                onBlur={() => setConfirmingRemoveAll(false)}
                autoFocus
              >
                Remove {pluralize(sources.length, 'video')}?
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                title="Remove all source videos from the app (files stay on disk)"
                onClick={() => setConfirmingRemoveAll(true)}
              >
                Remove all
              </Button>
            ))}
          <Button size="sm" icon="plus" onClick={onImport}>
            Import
          </Button>
        </>
      }
    >
      {sources.length === 0 ? (
        <EmptyState icon="film" title="No videos yet" hint="Import the videos you want to edit." />
      ) : (
        <ul className="source-list">
          {sources.map((source) => {
            const missing = missingPaths.has(source.sourcePath)
            return (
              <li key={source.id} className={cx('source', missing && 'source--missing')}>
                <button
                  type="button"
                  className="source__select"
                  aria-pressed={source.id === activeId}
                  onClick={() => onSelect(source.id)}
                >
                  <Thumb src={source.thumbnailUrl} className="source__thumb" />
                  <span className="source__text">
                    <span className="truncate" title={source.name}>
                      {source.name}
                    </span>
                    {missing ? (
                      <small className="missing-label">File missing</small>
                    ) : (
                      <small>{formatDuration(source.durationSec)}</small>
                    )}
                  </span>
                </button>
                <IconButton
                  icon="trash"
                  className="source-list__remove"
                  label={`Remove ${source.name}`}
                  onClick={() => onRemove(source.id)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

interface CaptionsPanelProps {
  presets: readonly CaptionPreset[]
  activeId: string | null
  onSelect: (id: string | null) => void
  onAdd: (text: string) => void
  onDelete: (id: string) => void
  syncCaption: boolean
  onToggleSync: (enabled: boolean) => void
  /** No source videos yet, so there is nothing to caption. */
  disabled: boolean
}

function CaptionsPanel({
  presets,
  activeId,
  onSelect,
  onAdd,
  onDelete,
  syncCaption,
  onToggleSync,
  disabled
}: CaptionsPanelProps) {
  const [draft, setDraft] = useState('')
  const inputId = useId()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onAdd(text)
    setDraft('')
  }

  return (
    <Panel title="Caption presets">
      {/* {disabled && <p className="field-hint">Import a video to use caption presets.</p>} */}
      <fieldset className="fieldset-contents" disabled={disabled}>
        <form className="inline-form" onSubmit={handleSubmit}>
          <label htmlFor={inputId} className="sr-only">
            New caption preset
          </label>
          <input
            id={inputId}
            className="input"
            value={draft}
            maxLength={200}
            placeholder="Write a caption"
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" size="sm" icon="plus" disabled={!draft.trim()}>
            Add
          </Button>
        </form>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={syncCaption}
            onChange={(e) => onToggleSync(e.target.checked)}
          />
          <span>Same caption text on all videos</span>
        </label>
        {syncCaption && (
          <p className="field-hint">Selecting a caption applies it to every video.</p>
        )}
        {presets.length === 0 ? (
          <EmptyState
            icon="link"
            title="No presets yet"
            hint="Saved captions show up here so you can reuse them."
          />
        ) : (
          <RadioList
            legend="Caption preset"
            noneLabel="No caption"
            selectedId={activeId}
            onSelect={onSelect}
            onDelete={onDelete}
            items={presets.map((p) => ({ id: p.id, label: p.text }))}
          />
        )}
      </fieldset>
    </Panel>
  )
}
