import { useId, useMemo, useState, type FormEvent } from 'react';
import { Button, EmptyState, IconButton, Panel, Segmented, Thumb } from '../../components/ui';
import { formatBytes, formatRelativeTime, pluralize } from '../../lib/format';
import { isTikTokUrl, parseLinks } from '../../lib/links';
import type { DownloadItem, DownloadMode, DownloadStatus } from '../../types';

export interface DownloaderPageProps {
  history: readonly DownloadItem[];
  onDownloadSingle: (url: string) => void;
  onDownloadBatch: (urls: string[]) => void;
  onShowInFolder: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

export function DownloaderPage({
  history,
  onDownloadSingle,
  onDownloadBatch,
  onShowInFolder,
  onRetry,
  onRemove,
}: DownloaderPageProps) {
  return (
    <div className="page page--downloader">
      <div className="downloader__top">
        <SingleDownload onSubmit={onDownloadSingle} />
        <BatchDownload onSubmit={onDownloadBatch} />
      </div>
      <History history={history} onShowInFolder={onShowInFolder} onRetry={onRetry} onRemove={onRemove} />
    </div>
  );
}

function SingleDownload({ onSubmit }: { onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState('');
  const inputId = useId();
  const errorId = useId();
  const trimmed = url.trim();
  const isValid = isTikTokUrl(trimmed);
  const showError = trimmed !== '' && !isValid;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid) return;
    onSubmit(trimmed);
    setUrl('');
  };

  return (
    <Panel title="Single link">
      <form className="dl-form" onSubmit={handleSubmit} noValidate>
        <div className="dl-form__field">
          <label className="sr-only" htmlFor={inputId}>
            TikTok link
          </label>
          <input
            id={inputId}
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste a TikTok link"
            value={url}
            aria-invalid={showError}
            aria-describedby={showError ? errorId : undefined}
            onChange={(e) => setUrl(e.target.value)}
          />
          {showError && (
            <p id={errorId} className="field-error" role="alert">
              That doesn’t look like a TikTok link.
            </p>
          )}
        </div>
        <Button type="submit" variant="primary" icon="download" disabled={!isValid}>
          Download
        </Button>
      </form>
    </Panel>
  );
}

function BatchDownload({ onSubmit }: { onSubmit: (urls: string[]) => void }) {
  const [text, setText] = useState('');
  const inputId = useId();
  const { valid, invalid } = useMemo(() => parseLinks(text), [text]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (valid.length === 0) return;
    onSubmit(valid);
    setText('');
  };

  return (
    <Panel title="Multiple links">
      <form className="dl-form dl-form--batch" onSubmit={handleSubmit}>
        <div className="dl-form__field">
          <label className="sr-only" htmlFor={inputId}>
            TikTok links, one per line
          </label>
          <textarea
            id={inputId}
            className="input"
            spellCheck={false}
            placeholder="Paste one link per line"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="dl-form__side">
          <p className="muted" aria-live="polite">
            {text.trim() === ''
              ? 'No links yet'
              : invalid > 0
                ? `${pluralize(valid.length, 'link')} ready, ${invalid} skipped`
                : `${pluralize(valid.length, 'link')} ready`}
          </p>
          <Button type="submit" variant="primary" icon="download" disabled={valid.length === 0}>
            Download all
          </Button>
        </div>
      </form>
    </Panel>
  );
}

type HistoryFilter = 'all' | DownloadMode;
const FILTERS: readonly { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'single', label: 'Single' },
  { value: 'batch', label: 'Batch' },
];

interface HistoryProps extends Pick<DownloaderPageProps, 'history' | 'onShowInFolder' | 'onRetry' | 'onRemove'> {}

function History({ history, onShowInFolder, onRetry, onRemove }: HistoryProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all');

  const visible = useMemo(
    () =>
      history
        .filter((item) => filter === 'all' || item.mode === filter)
        .sort((a, b) => b.createdAt - a.createdAt),
    [history, filter],
  );

  return (
    <Panel
      title="Download history"
      bodyClassName="panel__body--flush"
      actions={<Segmented legend="Show downloads" hideLegend options={FILTERS} value={filter} onChange={setFilter} />}
    >
      {visible.length === 0 ? (
        <EmptyState
          icon="download"
          title={history.length === 0 ? 'No downloads yet' : 'Nothing in this view'}
          hint={history.length === 0 ? 'Videos you download will be listed here.' : 'Try a different filter.'}
        />
      ) : (
        <ul className="history">
          {visible.map((item) => (
            <HistoryRow
              key={item.id}
              item={item}
              onShowInFolder={onShowInFolder}
              onRetry={onRetry}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  done: 'Done',
  failed: 'Failed',
};

function HistoryRow({
  item,
  onShowInFolder,
  onRetry,
  onRemove,
}: { item: DownloadItem } & Pick<DownloaderPageProps, 'onShowInFolder' | 'onRetry' | 'onRemove'>) {
  return (
    <li className="history__item">
      <Thumb src={item.thumbnailUrl} className="history__thumb" />
      <div className="history__main">
        <p className="history__title truncate" title={item.title}>
          {item.title}
        </p>
        <p className="history__url truncate" title={item.url}>
          {item.url}
        </p>
        {item.status === 'downloading' && (
          <progress className="progress" value={item.progress} max={100} aria-label={`Downloading ${item.title}`} />
        )}
      </div>
      <div className="history__meta">
        <div className="history__badges">
          <span className="badge">{item.mode === 'batch' ? 'Batch' : 'Single'}</span>
          <span className={`badge badge--${item.status}`}>
            {STATUS_LABEL[item.status]}
            {item.status === 'downloading' && ` ${Math.round(item.progress)}%`}
          </span>
        </div>
        <span className="muted">{item.sizeBytes ? formatBytes(item.sizeBytes) : '—'}</span>
        <span className="muted">{formatRelativeTime(item.createdAt)}</span>
      </div>
      <div className="history__actions">
        {item.status === 'done' && (
          <IconButton icon="folder" label={`Show ${item.title} in folder`} onClick={() => onShowInFolder(item.id)} />
        )}
        {item.status === 'failed' && (
          <IconButton icon="retry" label={`Retry ${item.title}`} onClick={() => onRetry(item.id)} />
        )}
        <IconButton icon="trash" label={`Remove ${item.title} from history`} onClick={() => onRemove(item.id)} />
      </div>
    </li>
  );
}
