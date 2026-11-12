import { useMemo, useReducer } from 'react'
import type {
  EditorSettings,
  ExportQuality,
  NumericVideoKey,
  SourceEditSettings,
  TextStyle,
  VideoProps
} from '../../types'
import { clampCopies } from '../../../../shared/exportConstants'
import { DEFAULT_VIDEO, INITIAL_SETTINGS, INITIAL_SOURCE_SETTINGS, VIDEO_CONTROLS } from './config'

type Action =
  | { type: 'patchText'; sourceId: string; patch: Partial<TextStyle> }
  | { type: 'setVideoProp'; sourceId: string; key: NumericVideoKey; value: number }
  | { type: 'setVideoFlip'; sourceId: string; flip: boolean }
  | { type: 'resetVideo'; sourceId: string }
  | { type: 'randomizeVideo'; sourceId: string }
  | { type: 'setOriginalAudio'; sourceId: string; enabled: boolean }
  | { type: 'setMusic'; sourceId: string; id: string | null }
  | { type: 'setQuality'; quality: ExportQuality }
  | { type: 'setActiveSource'; id: string | null }
  | { type: 'setCaptionPreset'; sourceId: string; id: string | null }
  | { type: 'setFullRandomize'; enabled: boolean }
  | { type: 'setCopies'; copies: number }
  | { type: 'setSyncText'; enabled: boolean; sourceId: string | null }
  | { type: 'setSyncCaption'; enabled: boolean; sourceId: string | null }
  | { type: 'hydrate'; saved: Partial<EditorSettings> }
  | { type: 'removeSources'; ids: string[] }

function randomInRange([min, max]: readonly [number, number], step: number): number {
  const raw = min + Math.random() * (max - min)
  // Keep as many decimals as the step has (a fixed 2 would round +-0.025 to 0.03, outside its range).
  const decimals = (String(step).split('.')[1] ?? '').length
  const snapped = Math.min(max, Math.max(min, Math.round(raw / step) * step))
  return Number(snapped.toFixed(decimals))
}

/** Random value for every video control, within its `randomRange`. Flip is a coin toss, as in spike2.mjs. */
export function randomVideoProps(): VideoProps {
  const next = { ...DEFAULT_VIDEO, flip: Math.random() < 0.5 }
  for (const control of VIDEO_CONTROLS) {
    next[control.key] = randomInRange(control.randomRange, control.step)
  }
  return next
}

/**
 * While `syncText` / `syncCaption` is on, every video uses `sharedText` / `sharedCaptionPresetId`. Videos never
 * edited also start from them, so after an option is turned off they keep the shared value instead of the default.
 */
function sourceSettings(state: EditorSettings, sourceId: string): SourceEditSettings {
  const own = state.sourceSettings[sourceId]
  const base = own ?? INITIAL_SOURCE_SETTINGS
  return {
    ...base,
    text: state.syncText || !own ? state.sharedText : base.text,
    captionPresetId: state.syncCaption || !own ? state.sharedCaptionPresetId : base.captionPresetId
  }
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
      if (state.syncText) {
        return { ...state, sharedText: { ...state.sharedText, ...action.patch } }
      }
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        text: { ...settings.text, ...action.patch }
      }))
    case 'setVideoProp':
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        video: { ...settings.video, [action.key]: action.value }
      }))
    case 'setVideoFlip':
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        video: { ...settings.video, flip: action.flip }
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
      if (state.syncCaption) return { ...state, sharedCaptionPresetId: action.id }
      return updateSourceSettings(state, action.sourceId, (settings) => ({
        ...settings,
        captionPresetId: action.id
      }))
    case 'setFullRandomize':
      return { ...state, fullRandomize: action.enabled }
    case 'setCopies':
      return { ...state, copies: clampCopies(action.copies) }
    case 'setSyncText': {
      if (action.enabled === state.syncText) return state
      if (action.enabled) {
        // Start from the video on screen, so it doesn't jump and its style is copied to the others.
        const current = action.sourceId
          ? sourceSettings(state, action.sourceId).text
          : state.sharedText
        return { ...state, syncText: true, sharedText: current }
      }
      // Every video keeps the shared style, and can be edited on its own again.
      const sourceSettingsWithShared = Object.fromEntries(
        Object.entries(state.sourceSettings).map(([id, settings]) => [
          id,
          { ...settings, text: state.sharedText }
        ])
      )
      return { ...state, syncText: false, sourceSettings: sourceSettingsWithShared }
    }
    case 'setSyncCaption': {
      if (action.enabled === state.syncCaption) return state
      if (action.enabled) {
        // Start from the caption of the video on screen.
        const current = action.sourceId
          ? sourceSettings(state, action.sourceId).captionPresetId
          : state.sharedCaptionPresetId
        return { ...state, syncCaption: true, sharedCaptionPresetId: current }
      }
      // Every video keeps the shared caption, and can be changed on its own again.
      const withSharedCaption = Object.fromEntries(
        Object.entries(state.sourceSettings).map(([id, settings]) => [
          id,
          { ...settings, captionPresetId: state.sharedCaptionPresetId }
        ])
      )
      return { ...state, syncCaption: false, sourceSettings: withSharedCaption }
    }
    case 'hydrate':
      // Over the defaults, so fields added since the session was saved still get a value.
      return {
        ...INITIAL_SETTINGS,
        ...action.saved,
        sharedText: { ...INITIAL_SETTINGS.sharedText, ...action.saved.sharedText },
        copies: clampCopies(action.saved.copies ?? INITIAL_SETTINGS.copies)
      }
    case 'removeSources': {
      const removed = new Set(action.ids)
      return {
        ...state,
        sourceSettings: Object.fromEntries(
          Object.entries(state.sourceSettings).filter(([id]) => !removed.has(id))
        ),
        activeSourceId:
          state.activeSourceId && removed.has(state.activeSourceId) ? null : state.activeSourceId
      }
    }
  }
}

export function useEditorSettings() {
  const [settings, dispatch] = useReducer(reducer, INITIAL_SETTINGS)

  // dispatch is stable, so this object is created once and never busts memoized children.
  const actions = useMemo(
    () => ({
      patchText: (sourceId: string, patch: Partial<TextStyle>) =>
        dispatch({ type: 'patchText', sourceId, patch }),
      setVideoProp: (sourceId: string, key: NumericVideoKey, value: number) =>
        dispatch({ type: 'setVideoProp', sourceId, key, value }),
      setVideoFlip: (sourceId: string, flip: boolean) =>
        dispatch({ type: 'setVideoFlip', sourceId, flip }),
      resetVideo: (sourceId: string) => dispatch({ type: 'resetVideo', sourceId }),
      randomizeVideo: (sourceId: string) => dispatch({ type: 'randomizeVideo', sourceId }),
      setOriginalAudio: (sourceId: string, enabled: boolean) =>
        dispatch({ type: 'setOriginalAudio', sourceId, enabled }),
      setMusic: (sourceId: string, id: string | null) =>
        dispatch({ type: 'setMusic', sourceId, id }),
      setQuality: (quality: ExportQuality) => dispatch({ type: 'setQuality', quality }),
      setActiveSource: (id: string | null) => dispatch({ type: 'setActiveSource', id }),
      setCaptionPreset: (sourceId: string, id: string | null) =>
        dispatch({ type: 'setCaptionPreset', sourceId, id }),
      setFullRandomize: (enabled: boolean) => dispatch({ type: 'setFullRandomize', enabled }),
      setCopies: (copies: number) => dispatch({ type: 'setCopies', copies }),
      setSyncText: (enabled: boolean, sourceId: string | null) =>
        dispatch({ type: 'setSyncText', enabled, sourceId }),
      setSyncCaption: (enabled: boolean, sourceId: string | null) =>
        dispatch({ type: 'setSyncCaption', enabled, sourceId }),
      hydrate: (saved: Partial<EditorSettings>) => dispatch({ type: 'hydrate', saved }),
      removeSources: (ids: string[]) => dispatch({ type: 'removeSources', ids })
    }),
    []
  )

  const getSourceSettings = (sourceId: string | null): SourceEditSettings =>
    // No video yet: an unknown id falls back to the defaults plus the shared caption and style.
    sourceSettings(settings, sourceId ?? '')

  return { settings, actions, getSourceSettings }
}

export type EditorApi = ReturnType<typeof useEditorSettings>
