export const VIDEO_BUTTON_TAG = 'pkaf-video';

export type VideoButtonState = 'checking' | 'ready' | 'unavailable' | 'starting' | 'started' | 'error';
export type VideoButtonVariant = 'inline' | 'overlay';

export interface VideoButton {
  element: HTMLElement;
  set(state: VideoButtonState, message: string, label?: string): void;
  onActivate(handler: (() => void) | null): void;
  remove(): void;
}

const ICONS: Record<VideoButtonState, string> = {
  checking: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="12 8"/>',
  ready: '<path d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  unavailable: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="m6.5 6.5 11 11" stroke="currentColor" stroke-width="2"/>',
  starting: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="12 8"/>',
  started: '<path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  error: '<path d="M12 7v6m0 4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>',
};

const LABELS: Record<VideoButtonState, string> = {
  checking: 'Checking…',
  ready: 'Download',
  unavailable: 'No download',
  starting: 'Starting…',
  started: 'Downloading',
  error: 'Retry',
};

const ACTIVE_STATES = new Set<VideoButtonState>(['ready', 'error']);

const STYLES = `
:host { all: initial; }
:host([data-variant="inline"]) { display: inline-block; margin-left: 6px; vertical-align: middle; }
:host([data-variant="overlay"]) { position: fixed; z-index: 2147483000; display: none; }
:host([data-visible]) { display: block; }
button { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #dadce0; background: #fff; color: #5f6368;
  font: 500 11px/16px Arial, Helvetica, sans-serif; cursor: default; padding: 0 7px; height: 18px; border-radius: 9px; }
svg { width: 12px; height: 12px; flex: none; }
button[data-state="ready"], button[data-state="error"] { cursor: pointer; }
button[data-state="ready"] { color: #1a73e8; border-color: #aecbfa; }
button[data-state="started"] { color: #188038; }
button[data-state="error"] { color: #d93025; }
button[data-state="checking"] svg, button[data-state="starting"] svg { animation: spin 1s linear infinite; }
:host([data-variant="overlay"]) button { width: 32px; height: 32px; padding: 0; justify-content: center; border-radius: 50%;
  border: 0; background: rgba(32,33,36,.78); color: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
:host([data-variant="overlay"]) button[data-state="ready"] { background: #188038; }
:host([data-variant="overlay"]) button[data-state="error"] { background: #d93025; }
:host([data-variant="overlay"]) svg { width: 16px; height: 16px; }
:host([data-variant="overlay"]) .label { display: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-color-scheme: dark) {
  :host([data-variant="inline"]) button { background: #303134; border-color: #5f6368; color: #bdc1c6; }
  :host([data-variant="inline"]) button[data-state="ready"] { color: #8ab4f8; }
}`;

export function createVideoButton(variant: VideoButtonVariant): VideoButton {
  const host = document.createElement(VIDEO_BUTTON_TAG);
  host.dataset.variant = variant;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const button = document.createElement('button');
  button.type = 'button';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'label';
  button.append(icon, label);
  shadow.append(style, button);
  let state: VideoButtonState = 'checking';
  let handler: (() => void) | null = null;

  for (const type of ['mousedown', 'auxclick', 'pointerdown'] as const) {
    host.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
  host.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (ACTIVE_STATES.has(state)) handler?.();
  });

  return {
    element: host,
    set(next, message, text) {
      state = next;
      button.dataset.state = next;
      icon.innerHTML = ICONS[next];
      label.textContent = text ?? LABELS[next];
      button.title = message;
      button.setAttribute('aria-label', message);
      button.disabled = !ACTIVE_STATES.has(next) && next !== 'unavailable';
    },
    onActivate(next) {
      handler = next;
    },
    remove: () => host.remove(),
  };
}
