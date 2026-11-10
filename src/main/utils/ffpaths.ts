import { app } from 'electron'
import path from 'node:path'
import { getFont } from '../../shared/fonts'

const ffmpegDirectory = app.isPackaged
  ? path.join(process.resourcesPath)
  : path.join(app.getAppPath(), 'resources')

export const ffmpegPath = path.join(ffmpegDirectory, 'ffmpeg.exe')

export const ffprobePath = path.join(ffmpegDirectory, 'ffprobe.exe')

/** Directory holding ffmpeg/ffprobe, passed to yt-dlp as `--ffmpeg-location`. */
export const ffmpegLocation = ffmpegDirectory

/** Absolute path of the .ttf for a caption font id, as FFmpeg's drawtext `fontfile` expects. */
export function fontFilePath(fontId: string): string {
  const { file } = getFont(fontId)
  // "SF Pro" has no bundled file; Segoe UI Bold is the Windows system UI font.
  if (!file) return path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'segoeuib.ttf')
  return path.join(ffmpegDirectory, 'fonts', file)
}

/** Read-only yt-dlp shipped with the app. It is copied to userData before use so it can self-update. */
export const bundledYtDlpPath = path.join(ffmpegDirectory, 'yt-dlp.exe')
