import { useId, useState, type FormEvent } from 'react';
import { Button, EmptyState, IconButton, Panel, RadioList, Thumb } from '../../components/ui';
import { formatDuration, pluralize } from '../../lib/format';
import type { CaptionPreset, PhotoFolder, SourceVideo } from '../../types';

interface MediaColumnProps {
  photoFolder: PhotoFolder | null;
  sources: readonly SourceVideo[];
  activeSourceId: string | null;
  presets: readonly CaptionPreset[];
  activePresetId: string | null;
  onPickPhotoFolder: () => void;
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
      <PhotosPanel folder={props.photoFolder} onPick={props.onPickPhotoFolder} />
      <SourcesPanel
        sources={props.sources}
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

function PhotosPanel({ folder, onPick }: { folder: PhotoFolder | null; onPick: () => void }) {
  return (
    <Panel
      title="Flash images"
      actions={
        <Button size="sm" icon="folder" onClick={onPick}>
          Choose folder
        </Button>
      }
    >
      {folder ? (
        <>
          <div className="folder-info">
            <span className="truncate" title={folder.path}>
              {folder.path}
            </span>
            <span className="muted">{pluralize(folder.images.length, 'image')}</span>
          </div>
          <ul className="thumb-grid">
            {folder.images.map((image) => (
              <li key={image.id}>
                <Thumb src={image.url} alt={image.name} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          icon="image"
          title="No folder chosen"
          hint="Images from the folder flash at random positions during the video."
        />
      )}
    </Panel>
  );
}

interface SourcesPanelProps {
  sources: readonly SourceVideo[];
  activeId: string | null;
  onImport: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

function SourcesPanel({ sources, activeId, onImport, onSelect, onRemove }: SourcesPanelProps) {
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
          {sources.map((source) => (
            <li key={source.id} className="source">
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
                  <small>{formatDuration(source.durationSec)}</small>
                </span>
              </button>
              <IconButton icon="trash" label={`Remove ${source.name}`} onClick={() => onRemove(source.id)} />
            </li>
          ))}
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
