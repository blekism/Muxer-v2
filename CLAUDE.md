# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Windows-focused Electron + React 19 + TypeScript desktop app (electron-vite) for batch-editing videos: import source videos, set per-video text/caption, color/transform, and audio settings with a live CSS preview, then export each video through a bundled FFmpeg.

## Commands

```bash
npm install          # postinstall installs Electron and rebuilds native deps
npm run dev          # electron-vite dev with HMR for the renderer
npm run typecheck    # tsc for both node (main/preload) and web (renderer) projects
npm run lint         # eslint (cached)
npm run format       # prettier --write .
npm run build        # typecheck + electron-vite build into out/
npm run build:win    # build + electron-builder Windows installer
```

There is no test suite. Verify changes with `npm run typecheck` and `npm run lint`, and by running the app.

Prettier style: single quotes, no semicolons, 100-column width, no trailing commas.

## FFmpeg binaries

`ffmpeg.exe`, `ffprobe.exe` and `yt-dlp.exe` (the official standalone build from the yt-dlp GitHub releases) must be in `resources/` (they're not committed). yt-dlp is copied to `userData/bin/` before it runs so it can update itself silently on startup (stable channel). [src/main/utils/ffpaths.ts](src/main/utils/ffpaths.ts) resolves them from `resources/` in dev and from `process.resourcesPath` when packaged (`extraResources` in [electron-builder.yml](electron-builder.yml)). Only `.exe` paths are wired up, so the app currently runs on Windows only.

[src/spike2.mjs](src/spike2.mjs) is a standalone Node experiment script for FFmpeg randomization (it reads `FFMPEG_PATH`/`FFPROBE_PATH`). Several config constants are derived from it. Files ending in `old` (`exportold.ts`, `configold.ts`, `PreviewColumnold.tsx`, `SettingsColumnold.tsx`) are earlier versions that nothing imports.

## Architecture

There are three processes, plus types shared between them:

- **`src/shared/types.ts`**: the data contract between main and renderer (`SourceVideo`, `SourceEditSettings`, `ExportRequest`, etc.). `src/renderer/src/types.ts` re-exports these and adds renderer-only types.
- **`src/main/index.ts`**: IPC handlers (`videos:import`, `photos:choose`, `music:import`, `library:load`/`library:save`, `export:run`/`export:cancel`), ffprobe-based media probing, and a custom privileged `media://<uuid>` protocol. The renderer never receives raw file paths to play. Main maps a random id to the path in `mediaPaths` and serves it (with range support) through `protocol.handle('media', ...)`. Caption presets and music are saved to `userData/editor-library.json`.
- **`src/preload/index.ts`**: exposes `window.api` (typed in `index.d.ts`). To add an IPC call, update all three: the handler in main, the bridge in preload, and the types in `index.d.ts`.
- **`src/main/export.ts`**: `exportVideos` renders each source in turn by building an FFmpeg `-filter_complex` (`buildFilters`). The chain covers zoom/rotation/perspective, `colortemperature`, `colorbalance` (tint), `vignette`, random photo "flash" overlays for each picked image (capped by `MAX_FLASH_IMAGES` in `src/shared/flashConstants.ts`), and `drawtext` captions. It sends `export:progress` events and stops when the `AbortSignal` from `export:cancel` fires.

### Renderer

`App.tsx` holds the app-level state (sources, flash images, presets, music, export progress) and switches between pages in `features/`: `editor`, `downloader` (uses mock data from `mock.ts`), and `library`. Editor state lives in `App` so it survives page switches.

The editor is split into `MediaColumn`, `PreviewColumn`, and `SettingsColumn`. Settings are stored per source (`EditorSettings.sourceSettings[sourceId]`) and managed by the reducer in `useEditorSettings.ts`.

**Units convention (important):** [config.ts](src/renderer/src/features/editor/config.ts) defines `VIDEO_CONTROLS` (range, step, neutral value, randomize range). It stores every value **in the units FFmpeg receives**, so `export.ts` uses them unchanged. Anything the CSS preview needs differently is converted only in [previewMath.ts](src/renderer/src/features/editor/previewMath.ts), never in config or export. For example, previewMath turns Kelvin into a `mix-blend-mode: multiply` overlay color that mimics `colortemperature`. Constants that both sides depend on (such as `TEMPERATURE_MIX`, which must equal the `mix` that `export.ts` passes) have to stay in sync by hand.

The open problem tracked in `issues.txt` is that the preview doesn't match the exported output. The approach under consideration is to normalize the UI sliders (for example -100 to 100) and map them to FFmpeg's ranges internally.

# Architecture Maps (Read before exploring `src/`)

Before scanning source directories, check the relevant module summary first:

- **Main Process & IPC Handlers:** `docs/arch-main.md`
- **Preload APIs & Bridge:** `docs/arch-preload.md`
- **Renderer UI & State:** `docs/arch-renderer.md`

# Rules

- Keep responses and code edits concise.
- When adding or changing an IPC channel, update the corresponding `docs/arch-*.md` file.
