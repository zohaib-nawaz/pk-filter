import { matchesStreamDomain } from '../core/hls';
import { extensionFromPath, safeHttpUrl } from '../core/media';
import type { DownloadResult } from '../core/messages';
import { maxHeightFor } from '../core/settings';
import type { DownloadOptions, MediaInfo, Settings } from '../core/types';
import { loadSettings } from '../shared/storage';
import { startDownload } from './download-manager';
import { inspectMedia } from './media-inspector';
import { inspectStream } from './stream-resolver';
import { startStreamJob } from './stream-jobs';
import { streamJobOptions } from './stream-options';

const STREAM_EXTENSIONS = ['m3u8', 'mpd'];
const TITLE_LIMIT = 300;

function streamPage(url: string, pageUrl: string | undefined, settings: Settings): string | null {
  const target = safeHttpUrl(url);
  const page = safeHttpUrl(pageUrl);
  if (!target || !page || !settings.videoDownloader) {
    return null;
  }
  const extension = extensionFromPath(target);
  if (!extension || !STREAM_EXTENSIONS.includes(extension) || !matchesStreamDomain(page.hostname, settings.streamDomains)) {
    return null;
  }
  return page.toString();
}

export async function inspectAny(url: string, pageUrl: string | undefined): Promise<MediaInfo> {
  const settings = await loadSettings();
  if (!streamPage(url, pageUrl, settings)) {
    return inspectMedia(url);
  }
  return inspectStream(url, maxHeightFor(settings.streamQuality));
}

export async function startAny(url: string, rawTitle: string, pageUrl: string | undefined, options: DownloadOptions): Promise<DownloadResult> {
  const title = rawTitle.slice(0, TITLE_LIMIT);
  const page = streamPage(url, pageUrl, await loadSettings());
  if (!page) {
    if (options.audioOnly) {
      return { ok: false, error: 'Audio only works for stream downloads' };
    }
    return startDownload(url, title);
  }
  return startStreamJob(url, title, page, await streamJobOptions(options.audioOnly, options.maxHeight));
}
