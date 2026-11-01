import { formatBytes } from '../core/download-errors';
import { sendRequest } from '../shared/messaging';
import type { MediaInfo } from '../core/types';
import type { VideoButton } from './video-button';

export async function prepareDownload(button: VideoButton, url: string, title: string): Promise<MediaInfo | null> {
  button.onActivate(null);
  button.set('checking', 'Checking whether this file can be downloaded…');
  const info = await sendRequest({ type: 'inspect-media', url });
  if (!info) {
    button.set('unavailable', 'The extension is not available on this page');
    return null;
  }
  if (info.status !== 'downloadable' || !info.extension) {
    button.set('unavailable', info.reason, info.status === 'streaming' ? 'Streaming only' : undefined);
    return null;
  }
  const detail = `${info.extension.toUpperCase()}, ${formatBytes(info.sizeBytes)}`;
  const start = async () => {
    button.set('starting', 'Starting download…');
    const result = await sendRequest({ type: 'download', url: info.url, title });
    if (result?.ok) button.set('started', 'Download started. Track it in the extension popup.');
    else button.set('error', `${result?.error ?? 'Could not start the download'}. Click to retry.`);
  };
  button.onActivate(() => void start());
  button.set('ready', `Download ${detail}`);
  return info;
}
