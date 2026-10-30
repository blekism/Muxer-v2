import { useId } from 'react'
import { Button, EmptyState, Panel, RadioList, Segmented, Slider } from '../../components/ui'
import { formatDuration } from '../../lib/format'
import type { HorizontalAlign, MusicTrack, VerticalAlign } from '../../types'
import { FONT_OPTIONS, QUALITY_OPTIONS, TEXT_SWATCHES, VIDEO_CONTROLS, fontStack } from './config'
import type { EditorApi } from './useEditorSettings'

const VERTICAL_OPTIONS: readonly { value: VerticalAlign; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' }
]
const HORIZONTAL_OPTIONS: readonly { value: HorizontalAlign; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' }
]

interface SettingsColumnProps {
  editor: EditorApi
  sourceId: string | null
  music: readonly MusicTrack[]
  activeMusicId: string | null
  onImportMusic: () => void
  onRemoveMusic: (id: string) => void
}

export function SettingsColumn({
  editor,
  sourceId,
  music,
  activeMusicId,
  onImportMusic,
  onRemoveMusic
}: SettingsColumnProps) {
  const { settings, actions } = editor
  const { text, video, audio } = editor.getSourceSettings(sourceId)
  const fontId = useId()

  return (
    <div className="editor__col editor__col--settings">
      <Panel title="Font">
        <div className="field">
          <label className="field-label" htmlFor={fontId}>
            Typeface
          </label>
          <select
            id={fontId}
            className="input"
            value={text.font}
            style={{ fontFamily: fontStack(text.font) }}
            onChange={(e) => sourceId && actions.patchText(sourceId, { font: e.target.value })}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <Panel title="Text size and outline">
        <Slider
          label="Size"
          value={text.size}
          min={24}
          max={120}
          step={1}
          unit="px"
          onChange={(size) => sourceId && actions.patchText(sourceId, { size })}
        />
        <Slider
          label="Outline"
          value={text.outline}
          min={0}
          max={12}
          step={1}
          unit="px"
          onChange={(outline) => sourceId && actions.patchText(sourceId, { outline })}
        />
      </Panel>

      <Panel title="Text colors">
        <ColorField
          label="Fill"
          value={text.fill}
          onChange={(fill) => sourceId && actions.patchText(sourceId, { fill })}
        />
        <ColorField
          label="Outline"
          value={text.outlineColor}
          onChange={(outlineColor) => sourceId && actions.patchText(sourceId, { outlineColor })}
        />
      </Panel>

      <Panel title="Text position">
        <Segmented
          legend="Vertical"
          options={VERTICAL_OPTIONS}
          value={text.vAlign}
          onChange={(vAlign) => sourceId && actions.patchText(sourceId, { vAlign })}
        />
        <Segmented
          legend="Horizontal"
          options={HORIZONTAL_OPTIONS}
          value={text.hAlign}
          onChange={(hAlign) => sourceId && actions.patchText(sourceId, { hAlign })}
        />
      </Panel>

      <Panel
        title="Video properties"
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon="reset"
              onClick={() => sourceId && actions.resetVideo(sourceId)}
            >
              Reset
            </Button>
            <Button
              size="sm"
              icon="dice"
              onClick={() => sourceId && actions.randomizeVideo(sourceId)}
            >
              Randomize
            </Button>
          </>
        }
      >
        {VIDEO_CONTROLS.map((control) => (
          <Slider
            key={control.key}
            label={control.label}
            value={video[control.key]}
            min={control.min}
            max={control.max}
            step={control.step}
            unit={control.unit}
            format={control.format}
            onChange={(value) => sourceId && actions.setVideoProp(sourceId, control.key, value)}
          />
        ))}
      </Panel>

      <Panel title="Audio">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={audio.originalEnabled}
            onChange={(event) =>
              sourceId && actions.setOriginalAudio(sourceId, event.target.checked)
            }
          />
          <span>Keep original audio</span>
        </label>
      </Panel>

      <Panel
        title="Music"
        actions={
          <Button size="sm" icon="plus" onClick={onImportMusic}>
            Import audio
          </Button>
        }
      >
        {music.length === 0 ? (
          <EmptyState icon="music" title="No audio yet" hint="Import an mp3 or other audio file." />
        ) : (
          <RadioList
            legend="Background music"
            noneLabel="No music"
            selectedId={activeMusicId}
            onSelect={(id) => sourceId && actions.setMusic(sourceId, id)}
            onDelete={onRemoveMusic}
            items={music.map((track) => ({
              id: track.id,
              label: track.name,
              meta: formatDuration(track.durationSec)
            }))}
          />
        )}
      </Panel>

      <Panel title="Export quality">
        <Segmented
          legend="Quality"
          hideLegend
          options={QUALITY_OPTIONS}
          value={settings.quality}
          onChange={actions.setQuality}
        />
      </Panel>
    </div>
  )
}

interface ColorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
}

function ColorField({ label, value, onChange }: ColorFieldProps) {
  const id = useId()
  return (
    <div className="color-field">
      <div className="color-field__head">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className="color-field__input"
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="muted">{value.toUpperCase()}</span>
      </div>
      <div className="swatches" role="group" aria-label={`${label} presets`}>
        {TEXT_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className="swatch"
            style={{ background: swatch }}
            aria-label={`Use ${swatch}`}
            aria-pressed={swatch === value.toLowerCase()}
            onClick={() => onChange(swatch)}
          />
        ))}
      </div>
    </div>
  )
}
