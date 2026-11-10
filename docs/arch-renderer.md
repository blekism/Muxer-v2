# `src/renderer` — React UI (sandboxed web process)

Everything the user sees and interacts with. It has no Node or filesystem access. It reaches the main process only through `window.api` (see `arch-preload.md`) and plays media only through `media://<id>` URLs.

## Entry points

- **`index.html`** — page shell and CSP (`default-src 'self'`; `img-src`/`media-src` allow `data:` and `media:`). App title is "Reelszer".
- **`src/main.tsx`** — mounts `<App />` in `StrictMode` and loads `styles.css`.
- **`src/App.tsx`** — root component and owner of all app-level state:
  - Sidebar navigation between the `editor`, `downloader` and `library` pages. This is a `useState`, with no router.
  - `sources`, `photoFolder`, `presets`, `music`, `exportProgress`, `downloads`, and the editor settings from `useEditorSettings()`. State lives here so it survives page switches.
  - IPC orchestration: imports videos, music and the photo folder; loads the library on mount and auto-saves `{ presets, music }` on change; builds the `ExportRequest` and calls `export.run` and `export.cancel`; subscribes to `export.onProgress`.
  - Downloads: loads `downloads.list()` and the folder on mount, and upserts items from `downloads.onUpdate`. Main owns the history; `downloads.start` doesn't return items, they arrive as update events. `onRemoveMany` calls `downloads.removeMany` and drops the items locally only if the user confirmed.

## Structure

- **`features/editor/`** — the main screen. `EditorPage` lays out three columns and is mostly props-driven.
  - `MediaColumn` — source list, photo folder, music.
  - `PreviewColumn` — live CSS preview of the active source.
  - `SettingsColumn` — per-source text/caption, video and audio controls, and export quality.
  - `useEditorSettings.ts` — reducer holding `EditorSettings`. Settings are stored per source in `sourceSettings[sourceId]`. It exposes `EditorApi`.
  - `config.ts` — `VIDEO_CONTROLS` (range, step, neutral value, randomize range, optional `display` scale), defaults, fonts, swatches and quality options. Values are **in FFmpeg units**, and the export uses them unchanged.
    - Temperature, tint, and vignette have `display: 0–100`. `toDisplay`/`fromDisplay` map linearly between that scale and the FFmpeg range in `SettingsColumn`, so state still holds Kelvin / gs / radians. On the temperature slider, 0 = 4200K (warm) and 100 = 6800K, with neutral 6500K at about 88.
  - `previewMath.ts` — converts FFmpeg units to CSS-preview values (a temperature `feColorMatrix`, the tint shadow-lift matrix, the vignette gradient, perspective). This is the only place unit conversion for the preview happens.
  - `PreviewColumn` applies temperature and tint as one inline SVG filter on the `<video>`, in sRGB and in FFmpeg's order. Vignette is a gradient overlay on top.
  - `*old.ts(x)` (`configold`, `PreviewColumnold`, `SettingsColumnold`) — dead earlier versions that nothing imports.
- **`features/downloader/DownloaderPage.tsx`** — TikTok link input (single or batch), a toolbar (output folder and Change), and the download history with progress, error text, and cancel, retry, show and remove actions. Every row and batch header has a checkbox, and there are no per-row trash buttons: deleting is one flow for one video or many. `History` keeps the selected ids. The panel toolbar has a single danger **Delete** button, disabled with 0 selected and labelled "Delete N video(s)" otherwise, which calls `onRemoveMany` with only the visible selected ids (a ticked batch counts all its links). A slim bar above the list has select-all, the count and Clear. The panel ends with a red, bottom-pinned note that deleting permanently deletes the video from the device. `groupHistory` folds batch items into one collapsible `BatchGroup` card per `batchId` (falling back to `createdAt` for older items). Groups start collapsed, and the card's aggregate progress and group actions loop over the per-item callbacks. It is props-driven, and `App` wires it to `window.api.downloads`.
- **`features/library/LibraryPage.tsx`** — read-only grid of the imported videos with totals.
- **`components/Navbar.tsx`**: `Navbar({ title, description })`, the top bar each page renders above its `.page` grid (inside a fragment).
- **`components/ui.tsx`** — shared presentational primitives: `Icon` (inline SVG paths), `Button`, `IconButton`, `Panel`, `EmptyState`, `Thumb`, `Slider`, `Segmented`, `RadioList`, `cx`.
- **`lib/`** — pure helpers. `format.ts` formats bytes, duration, resolution, relative time and plurals. `links.ts` validates and parses TikTok URLs.
- **`types.ts`** — re-exports the shared types from `src/shared/types.ts` (including `DownloadItem`, `DownloadStatus` and `DownloadMode`) and adds the renderer-only `EditorSettings`.
- **`styles.css`** — the active stylesheet. Colors are `:root` tokens following 60-30-10: black surfaces (`--bg`, `--surface` for cards, `--chrome` for the navbar and sidebar), purple `--secondary`/`--surface-3`/borders, and a cyan `--accent`. `assets/` holds `base.css`, `main.css` and the SVGs from the electron-vite template.
- **`env.d.ts`** — Vite client type references.

## Rules and gotchas

- The renderer never sees raw file paths for playback. `SourceVideo.previewUrl` is a `media://` URL minted by main.
- **Units convention:** config and export share FFmpeg units, and only `previewMath.ts` converts for CSS. Color constants that both sides depend on (`TEMPERATURE_KELVIN`, `TEMPERATURE_MIX`, `TINT_MAX`, `VIGNETTE_MAX_ANGLE`) live in `src/shared/colorConstants.ts`, which both main and renderer import.
- Per-source settings are keyed by source id. `App` reads them with `editor.getSourceSettings(id)` when it builds the export request.
- Open problem: the preview does not match the exported output (see `issues.txt`).
- Import style is mixed: `@renderer/types` alias, relative paths, and one `src/shared/types` import in `App.tsx`. The formatting also varies (semicolons in `lib/`, `main.tsx` and the downloader and library pages; none in `App.tsx` and the editor), so prefer the Prettier style when you touch a file.
