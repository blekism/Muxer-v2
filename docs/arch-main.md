# `src/main` — Electron main process

Owns everything that needs Node/OS access: windows, file dialogs, FFmpeg, and persistence. The renderer reaches it only through IPC (bridged in `src/preload/index.ts`).

## Files

- **`index.ts`** — app entry point and IPC surface.
  - Creates the `BrowserWindow` (preload, `sandbox: false`), loads the Vite dev URL or built `index.html`, and quits on `window-all-closed` (except on macOS).
  - On ready, runs `testFFmpeg()` (logs only) and registers all IPC handlers.
  - **IPC handlers:**
    - `videos:import` — opens an MP4 picker, then runs `probeVideo` on each file.
    - `photos:choose-folder` — returns the folder's image list, sorted by name.
    - `music:import` — opens an audio picker and ffprobes each file for its duration.
    - `library:load` / `library:save` — reads and writes `userData/editor-library.json` (caption presets and music). `load` falls back to an empty library on any error.
    - `export:run` — prompts for an output directory, then calls `exportVideos`. It rejects if an export is already running, returns `null` if the dialog is cancelled, and streams `export:progress` events to the sender.
    - `export:cancel` — aborts the active `AbortController`.
  - **`media://<uuid>` protocol:** a privileged scheme that serves local video and image files to the renderer.
    - `mediaPaths` maps each random id to a file path, so the renderer never sees raw paths.
    - The handler supports HTTP range requests (200, 206, 416) so `<video>` can seek.
    - Entries are never removed from `mediaPaths`, so it grows for the life of the app.
  - `probeVideo` swaps width and height when the stream is rotated 90° or 270°, so `SourceVideo` dimensions are display dimensions.
  - Leftover template code: the `ping` IPC test handler.
- **`export.ts`** — the render pipeline, exposed as `exportVideos(request, outDir, onProgress, signal)`.
  - Renders sources one at a time, in order.
  - Output is named `<name>_edited.mp4`, with a `-N` suffix on collisions.
  - Each source is probed again with ffprobe (fps, duration, audio track).
  - `buildFilters` produces one `-filter_complex` graph, in this order:
    1. Rotate the full frame, then crop to 9:16 divided by zoom, then scale to the quality width (480/720/1080) at 16:9 portrait height.
    2. Perspective, `colortemperature` (skipped at 6500K, `mix=0.5`), `colorbalance gs=` (tint), `vignette angle=`.
    3. Up to 5 images from the photo folder, each overlaid for 3 frames at a random start frame.
    4. `drawtext` caption, read from a temp file in `%TEMP%` that is deleted afterwards.
  - Encodes with libx264, using a CRF set by quality.
  - Audio comes from the chosen music track (looped), else the original audio if enabled, else none.
  - `trimStart` is applied with `-ss`.
  - Cancellation and timeouts: the `AbortSignal` is passed to `execFile`, and each render has a 30-minute timeout.
  - Settings values from the UI are passed to FFmpeg unchanged, apart from clamps.
- **`utils/ffpaths.ts`** — resolves `ffmpeg.exe` and `ffprobe.exe`.
  - Dev: `resources/`.
  - Packaged: `process.resourcesPath` (via `extraResources`).
  - Windows-only, because the `.exe` names are hardcoded.
- **`utils/test-ffpaths.ts`** — startup smoke test that runs `-version` on both binaries and logs the result.
- **`exportold.ts`** — earlier export implementation. Nothing imports it.

## Conventions and gotchas

- Types for requests and results come from `src/shared/types.ts`.
- Adding an IPC call means updating this directory's handlers, `src/preload/index.ts`, and `src/preload/index.d.ts`.
- `index.ts` and `export.ts` each define their own `probeVideo` and image-extension set, so changes to one don't carry over to the other.
