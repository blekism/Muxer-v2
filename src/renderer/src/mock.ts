// Demo data only. Delete this file once the screens are wired to Electron IPC / Supabase.
import type { CaptionPreset, DownloadItem, MusicTrack, SourceVideo } from './types'

const now = Date.now()

export const MOCK_SOURCES: SourceVideo[] = [
  {
    id: 's1',
    name: 'morning-routine.mp4',
    sourcePath: '',
    previewUrl: '',
    sizeBytes: 48_200_000,
    durationSec: 34,
    width: 1080,
    height: 1920
  },
  {
    id: 's2',
    name: 'street-food-tour.mov',
    sourcePath: '',
    previewUrl: '',
    sizeBytes: 212_000_000,
    durationSec: 92,
    width: 1080,
    height: 1920
  },
  {
    id: 's3',
    name: 'desk-setup-broll.mp4',
    sourcePath: '',
    previewUrl: '',
    sizeBytes: 19_800_000,
    durationSec: 18,
    width: 720,
    height: 1280
  }
]

export const MOCK_PRESETS: CaptionPreset[] = [
  { id: 'p1', text: 'Wait for the ending' },
  { id: 'p2', text: 'POV: it’s Monday again' },
  { id: 'p3', text: 'You need to try this' }
]

export const MOCK_MUSIC: MusicTrack[] = [
  { id: 'm1', name: 'lofi-sunrise.mp3', sourcePath: '', durationSec: 142 },
  { id: 'm2', name: 'upbeat-loop.mp3', sourcePath: '', durationSec: 63 }
]

export const MOCK_DOWNLOADS: DownloadItem[] = [
  {
    id: 'd1',
    url: 'https://www.tiktok.com/@creator/video/7301',
    title: 'Quick pasta hack',
    mode: 'single',
    status: 'done',
    progress: 100,
    sizeBytes: 8_400_000,
    createdAt: now - 3_600_000
  },
  {
    id: 'd2',
    url: 'https://www.tiktok.com/@creator/video/7302',
    title: 'Desk makeover',
    mode: 'batch',
    status: 'downloading',
    progress: 62,
    createdAt: now - 120_000
  },
  {
    id: 'd3',
    url: 'https://www.tiktok.com/@creator/video/7303',
    title: 'Gym fit check',
    mode: 'batch',
    status: 'failed',
    progress: 0,
    createdAt: now - 118_000
  }
]
