import { useMemo, useReducer } from 'react'
import type {
  EditorSettings,
  ExportQuality,
  SourceEditSettings,
  TextStyle,
  VideoProps
} from '../../types'
import { DEFAULT_VIDEO, INITIAL_SETTINGS, INITIAL_SOURCE_SETTINGS, VIDEO_CONTROLS } from './config'

type Action =
  | { type: 'patchText'; sourceId: string; patch: Partial<TextStyle> }
  | { type: 'setVideoProp'; sourceId: string; key: keyof VideoProps; value: number }
  | { type: 'resetVideo'; sourceId: string }
  | { type: 'randomizeVideo'; sourceId: string }
  | { type: 'setOriginalAudio'; sourceId: string; enabled: boolean }
  | { type: 'setMusic'; sourceId: string; id: string | null }
  | { type: 'setQuality'; quality: ExportQuality }
  | { type: 'setActiveSource'; id: string | null }
  | { type: 'setCaptionPreset'; sourceId: string; id: string | null }

function randomInRange([min, max]: readonly [number, number], step: number): number {
  const raw = min + Math.random() * (max - min)
  return Number((Math.round(raw / step) * step).toFixed(2))
}

function randomVideoProps(): VideoProps {
  const next = { ...DEFAULT_VIDEO }
  for (const control of VIDEO_CONTROLS) {
    next[control.key] = randomInRange(control.randomRange, control.step)
  }
  return next
}

function sourceSettings(state: EditorSettings, sourceId: string): SourceEditSettings {
  return state.sourceSettings[sourceId] ?? INITIAL_SOURCE_SETTINGS
}

function updateSourceSettings(
  state: EditorSettings,
  sourceId: string,
  update: (settings: SourceEditSettings) => SourceEditSettings
): EditorSettings {
  return {
    ...state,
    sourceSettings: {
      ...state.sourceSettings,
      [sourceId]: update(sourceSettings(state, sourceId))
    }
  }
}

function reducer(state: EditorSettings, action: Action): EditorSettings {
  switch (action.type) {
    case 'patchText':
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        text: { ...settings.text, ...action.patch }
      }))
    case 'setVideoProp':
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        video: { ...settings.video, [action.key]: action.value }
      }))
    case 'resetVideo':
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        video: DEFAULT_VIDEO
      }))
    case 'randomizeVideo':
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        video: randomVideoProps()
      }))
    case 'setOriginalAudio':
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        audio: { ...settings.audio, originalEnabled: action.enabled }
      }))
    case 'setMusic':
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        audio: { ...settings.audio, musicId: action.id }
      }))
    case 'setQuality':
      return { ...state, quality: action.quality }
    case 'setActiveSource':
      return { ...state, activeSourceId: action.id }
    case 'setCaptionPreset':
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        captionPresetId: action.id
      }))
  }
}

export function useEditorSettings() {
  const [settings, dispatch] = useReducer(reducer, INITIAL_SETTINGS)

  // dispatch is stable, so this object is created once and never busts memoized children.
  const actions = useMemo(
    () => ({
      patchText: (sourceId: string, patch: Partial<TextStyle>) =>
        dispatch({ type: 'patchText', sourceId, patch }),
      setVideoProp: (sourceId: string, key: keyof VideoProps, value: number) =>
        dispatch({ type: 'setVideoProp', sourceId, key, value }),
      resetVideo: (sourceId: string) => dispatch({ type: 'resetVideo', sourceId }),
      randomizeVideo: (sourceId: string) => dispatch({ type: 'randomizeVideo', sourceId }),
      setOriginalAudio: (sourceId: string, enabled: boolean) =>
        dispatch({ type: 'setOriginalAudio', sourceId, enabled }),
      setMusic: (sourceId: string, id: string | null) =>
        dispatch({ type: 'setMusic', sourceId, id }),
      setQuality: (quality: ExportQuality) => dispatch({ type: 'setQuality', quality }),
      setActiveSource: (id: string | null) => dispatch({ type: 'setActiveSource', id }),
      setCaptionPreset: (sourceId: string, id: string | null) =>
        dispatch({ type: 'setCaptionPreset', sourceId, id })
    }),
    []
  )

  const getSourceSettings = (sourceId: string | null): SourceEditSettings =>
    sourceId ? sourceSettings(settings, sourceId) : INITIAL_SOURCE_SETTINGS

  return { settings, actions, getSourceSettings }
}

export type EditorApi = ReturnType<typeof useEditorSettings>
