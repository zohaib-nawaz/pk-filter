export type VideoUiState = 'idle' | 'checking' | 'ready' | 'unavailable' | 'starting' | 'started' | 'error';

const ALWAYS_SHOWN = new Set<VideoUiState>(['ready', 'starting', 'started', 'error']);

export function isVideoButtonShown(state: VideoUiState, showUnavailable: boolean): boolean {
  return ALWAYS_SHOWN.has(state) || (state === 'unavailable' && showUnavailable);
}
