import { Button } from '../../components/ui'
import { pluralize } from '../../lib/format'
import type { CaptionPreset, MusicTrack, PhotoFolder, SourceVideo } from '@renderer/types'
import { QUALITY_OPTIONS } from './config'
import { MediaColumn } from './MediaColumn'
import { PreviewColumn } from './PreviewColumn'
import { SettingsColumn } from './SettingsColumn'
import type { EditorApi } from './useEditorSettings'

export interface EditorPageProps {
  editor: EditorApi
  sources: readonly SourceVideo[]
  photoFolder: PhotoFolder | null
  presets: readonly CaptionPreset[]
  music: readonly MusicTrack[]
  isGenerating: boolean
  onPickPhotoFolder: () => void
  onImportVideos: () => void
  onRemoveSource: (id: string) => void
  onAddPreset: (text: string) => void
  onDeletePreset: (id: string) => void
  onImportMusic: () => void
  onRemoveMusic: (id: string) => void
  onGenerate: () => void
  onCancelExport: () => void
}

export function EditorPage({
  editor,
  sources,
  photoFolder,
  presets,
  music,
  isGenerating,
  onPickPhotoFolder,
  onImportVideos,
  onRemoveSource,
  onAddPreset,
  onDeletePreset,
  onImportMusic,
  onRemoveMusic,
  onGenerate,
  onCancelExport
}: EditorPageProps) {
  const { settings, actions } = editor

  // Derive the active items instead of syncing them with effects: deleting a selected
  // item falls back to a sensible default without any extra state.
  const activeSource = sources.find((s) => s.id === settings.activeSourceId) ?? sources[0] ?? null
  const activeSourceSettings = editor.getSourceSettings(activeSource?.id ?? null)
  const activePreset = presets.find((p) => p.id === activeSourceSettings.captionPresetId) ?? null
  const activeMusic = music.find((m) => m.id === activeSourceSettings.audio.musicId) ?? null

  const canGenerate = sources.length > 0 && !isGenerating
  const qualityLabel = QUALITY_OPTIONS.find((q) => q.value === settings.quality)?.label ?? ''

  return (
    <div className="page page--editor">
      <div className="editor__columns">
        <MediaColumn
          photoFolder={photoFolder}
          sources={sources}
          activeSourceId={activeSource?.id ?? null}
          presets={presets}
          activePresetId={activePreset?.id ?? null}
          onPickPhotoFolder={onPickPhotoFolder}
          onImportVideos={onImportVideos}
          onSelectSource={actions.setActiveSource}
          onRemoveSource={onRemoveSource}
          onSelectPreset={(id) => {
            if (activeSource) actions.setCaptionPreset(activeSource.id, id)
          }}
          onAddPreset={onAddPreset}
          onDeletePreset={onDeletePreset}
        />
        <PreviewColumn
          source={activeSource}
          caption={activePreset?.text ?? ''}
          settings={activeSourceSettings}
        />
        <SettingsColumn
          editor={editor}
          sourceId={activeSource?.id ?? null}
          music={music}
          activeMusicId={activeSourceSettings.audio.musicId}
          onImportMusic={onImportMusic}
          onRemoveMusic={onRemoveMusic}
        />
      </div>

      <footer className="generate-bar">
        <dl className="generate-bar__summary">
          <div>
            <dt>Videos</dt>
            <dd>{pluralize(sources.length, 'video')}</dd>
          </div>
          <div>
            <dt>Quality</dt>
            <dd>{qualityLabel}</dd>
          </div>
          <div>
            <dt>Music</dt>
            <dd>{activeMusic ? activeMusic.name : 'None'}</dd>
          </div>
        </dl>
        <Button
          variant="primary"
          size="lg"
          icon="play"
          disabled={!canGenerate}
          aria-busy={isGenerating}
          aria-describedby={sources.length === 0 ? 'generate-hint' : undefined}
          onClick={onGenerate}
        >
          {isGenerating ? 'Generating…' : 'Generate'}
        </Button>
        {isGenerating && (
          <Button size="lg" variant="ghost" onClick={onCancelExport}>
            Cancel
          </Button>
        )}
        {sources.length === 0 && (
          <span id="generate-hint" className="sr-only">
            Import at least one source video to generate.
          </span>
        )}
      </footer>
    </div>
  )
}
