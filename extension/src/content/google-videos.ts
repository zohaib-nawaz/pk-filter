import { isStreamingPlatform, looksLikeDuration, sourceKind } from '../core/media';
import type { SearchResult } from './result-detector';
import { prepareDownload } from './video-actions';
import { createVideoButton, type VideoButton } from './video-button';

const STREAMING_MESSAGE = 'Streaming video, not a direct file. It cannot be downloaded from search results.';

function hasDuration(container: HTMLElement): boolean {
  for (const span of container.querySelectorAll('span')) {
    if (span.childElementCount === 0 && looksLikeDuration(span.textContent)) return true;
  }
  return false;
}

export function decorateVideoResult(result: SearchResult): VideoButton | null {
  const href = result.anchor.href;
  const kind = sourceKind(href);
  if (kind === 'direct') {
    const button = createVideoButton('inline');
    result.heading.append(button.element);
    void prepareDownload(button, href, result.title);
    return button;
  }
  if (kind === 'streaming' || isStreamingPlatform(result.domain) || hasDuration(result.container)) {
    const button = createVideoButton('inline');
    button.set('unavailable', STREAMING_MESSAGE, 'Streaming only');
    result.heading.append(button.element);
    return button;
  }
  return null;
}
