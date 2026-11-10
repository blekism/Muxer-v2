import { useId, useState, type FormEvent } from 'react';
import { Button, EmptyState, IconButton, Panel, RadioList, Thumb, cx } from '../../components/ui';
import { formatDuration, pluralize } from '../../lib/format';
import type { CaptionPreset, FlashImage, SourceVideo } from '../../types';
import { MAX_FLASH_IMAGES } from '../../../../shared/flashConstants';

interface MediaColumnProps {
  flashImages: readonly FlashImage[];
  flashNotice: string | null;
  missingPaths: ReadonlySet<string>;
  sources: readonly SourceVideo[];
  activeSourceId: string | null;
  presets: readonly CaptionPreset[];
  activePresetId: string | null;
  onPickFlashImages: () => void;
  onRemoveFlashImage: (id: string) => void;
  onImportVideos: () => void;
  onSelectSource: (id: string) => void;
  onRemoveSource: (id: string) => void;
  onSelectPreset: (id: string | null) => void;
  onAddPreset: (text: string) => void;
  onDeletePreset: (id: string) => void;
}

export function MediaColumn(props: MediaColumnProps) {
  return (
    <div className="editor__col editor__col--media">
      <PhotosPanel
        images={props.flashImages}
        notice={props.flashNotice}
        missingPaths={props.missingPaths}
        onPick={props.onPickFlashImages}
        onRemove={props.onRemoveFlashImage}
      />
      <SourcesPanel
        sources={props.sources}
        missingPaths={props.missingPaths}
        activeId={props.activeSourceId}
        onImport={props.onImportVideos}
        onSelect={props.onSelectSource}
        onRemove={props.onRemoveSource}
      />
      <CaptionsPanel
        presets={props.presets}
        activeId={props.activePresetId}
        onSelect={props.onSelectPreset}
        onAdd={props.onAddPreset}
        onDelete={props.onDeletePreset}
      />
    </div>
  );
}

function PhotosPanel({
  images,
  notice,
  missingPaths,
  onPick,
  onRemove,
}: {
  images: readonly FlashImage[];
  notice: string | null;
  missingPaths: ReadonlySet<string>;
  onPick: () => void;
  onRemove: (id: string) => void;
}) {
  const missingCount = images.filter((image) => missingPaths.has(image.path)).length;
  const full = images.length >= MAX_FLASH_IMAGES;
  return (
    <Panel
      title="Flash images"
      actions={
        <Button
          size="sm"
          icon="plus"
          onClick={onPick}
          disabled={full}
          title={full ? `Limit of ${MAX_FLASH_IMAGES} reached. Remove an image to add another.` : undefined}
        >
          Add images
        </Button>
      }
    >
      {images.length > 0 ? (
        <>
          <div className="folder-info">
            <span className="muted">
              {images.length} / {MAX_FLASH_IMAGES} images
            </span>
            {missingCount > 0 && (
              <span className="missing-label">{pluralize(missingCount, 'image')} missing</span>
            )}
            {notice && <span className="muted">{notice}</span>}
          </div>
          <ul className="thumb-grid">
            {images.map((image) => (
              <li
                key={image.id}
                className={cx('thumb-grid__item', missingPaths.has(image.path) && 'thumb-grid__item--missing')}
                title={missingPaths.has(image.path) ? `${image.name} (missing)` : image.name}
              >
                <Thumb src={image.url} alt={image.name} />
                <IconButton
                  icon="close"
                  label={`Remove ${image.name}`}
                  className="thumb-grid__remove"
                  onClick={() => onRemove(image.id)}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          icon="image"
          title="No images chosen"
          hint={`Each image flashes once at a random point in the video (up to ${MAX_FLASH_IMAGES}).`}
        />
      )}
    </Panel>
  );
}

interface SourcesPanelProps {
  sources: readonly SourceVideo[];
  missingPaths: ReadonlySet<string>;
  activeId: string | null;
  onImport: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

function SourcesPanel({ sources, missingPaths, activeId, onImport, onSelect, onRemove }: SourcesPanelProps) {
  return (
    <Panel
      title="Source videos"
      actions={
        <Button size="sm" icon="plus" onClick={onImport}>
          Import
        </Button>
      }
    >
      {sources.length === 0 ? (
        <EmptyState icon="film" title="No videos yet" hint="Import the videos you want to edit." />
      ) : (
        <ul className="source-list">
          {sources.map((source) => {
            const missing = missingPaths.has(source.sourcePath);
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
              <IconButton icon="trash" label={`Remove ${source.name}`} onClick={() => onRemove(source.id)} />
            </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

interface CaptionsPanelProps {
  presets: readonly CaptionPreset[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
}

function CaptionsPanel({ presets, activeId, onSelect, onAdd, onDelete }: CaptionsPanelProps) {
  const [draft, setDraft] = useState('');
  const inputId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };

  return (
    <Panel title="Caption presets">
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
      {presets.length === 0 ? (
        <EmptyState icon="link" title="No presets yet" hint="Saved captions show up here so you can reuse them." />
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
    </Panel>
  );
}
