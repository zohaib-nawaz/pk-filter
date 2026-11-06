import { brandId } from '../core/brand';
import type { VideoUiState } from '../core/video-visibility';

export const VIDEO_BUTTON_TAG = brandId('video');

export type VideoButtonState = Exclude<VideoUiState, 'idle'>;
export type VideoButtonVariant = 'inline' | 'overlay';

export interface VideoMenuItem {
  label: string;
  detail: string;
  pick: () => void;
}

export interface VideoButton {
  element: HTMLElement;
  set(state: VideoButtonState, message: string, label?: string): void;
  state(): VideoUiState;
  onActivate(handler: (() => void) | null): void;
  toggleMenu(title: string, items: VideoMenuItem[]): void;
  show(visible: boolean): void;
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
:host([data-variant="overlay"]) { position: fixed; inset: auto; z-index: 2147483647; display: none; margin: 0; padding: 0; border: 0;
  width: 32px; height: 32px; background: transparent; overflow: visible; }
:host([data-visible]) { display: block; }
.main { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #dadce0; background: #fff; color: #5f6368;
  font: 500 11px/16px Arial, Helvetica, sans-serif; cursor: default; padding: 0 7px; height: 18px; border-radius: 9px; }
svg { width: 12px; height: 12px; flex: none; }
.main[data-state="ready"], .main[data-state="error"] { cursor: pointer; }
.main[data-state="ready"] { color: #1a73e8; border-color: #aecbfa; }
.main[data-state="started"] { color: #188038; }
.main[data-state="error"] { color: #d93025; }
.main[data-state="checking"] svg, .main[data-state="starting"] svg { animation: spin 1s linear infinite; }
:host([data-variant="overlay"]) .main { width: 32px; height: 32px; padding: 0; justify-content: center; border-radius: 50%;
  border: 0; background: rgba(32,33,36,.78); color: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
:host([data-variant="overlay"]) .main[data-state="ready"] { background: #188038; }
:host([data-variant="overlay"]) .main[data-state="error"] { background: #d93025; }
:host([data-variant="overlay"]) svg { width: 16px; height: 16px; }
:host([data-variant="overlay"]) .label { display: none; }
.menu { position: absolute; right: 0; top: 40px; box-sizing: border-box; min-width: 176px; max-height: 300px; overflow-y: auto;
  padding: 6px; border-radius: 12px; background: #fff; color: #202124; box-shadow: 0 6px 24px rgba(0,0,0,.28);
  font: 13px/18px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; text-align: left; }
.menu[hidden] { display: none; }
.menu[data-above] { top: auto; bottom: 40px; }
:host([data-variant="inline"]) .menu { top: 22px; left: 0; right: auto; }
.title { padding: 4px 10px 6px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #5f6368; }
.item { display: flex; width: 100%; justify-content: space-between; gap: 16px; padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.item:hover, .item:focus-visible { background: #e6f4ea; outline: none; }
.detail { color: #5f6368; white-space: nowrap; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-color-scheme: dark) {
  :host([data-variant="inline"]) .main { background: #303134; border-color: #5f6368; color: #bdc1c6; }
  :host([data-variant="inline"]) .main[data-state="ready"] { color: #8ab4f8; }
  .menu { background: #2d2e31; color: #e8eaed; }
  .item:hover, .item:focus-visible { background: #3c4043; }
  .title, .detail { color: #9aa0a6; }
}`;

function supportsPopover(element: HTMLElement): boolean {
  return typeof element.showPopover === 'function';
}

function menuRow(item: VideoMenuItem, choose: (item: VideoMenuItem) => void): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'item';
  row.setAttribute('role', 'menuitem');
  const name = document.createElement('span');
  name.textContent = item.label;
  const detail = document.createElement('span');
  detail.className = 'detail';
  detail.textContent = item.detail;
  row.append(name, detail);
  row.addEventListener('click', (event) => {
    event.preventDefault();
    choose(item);
  });
  return row;
}

export function createVideoButton(variant: VideoButtonVariant, onStateChange?: () => void): VideoButton {
  const host = document.createElement(VIDEO_BUTTON_TAG);
  host.dataset.variant = variant;
  if (variant === 'overlay' && supportsPopover(host)) {
    host.setAttribute('popover', 'manual');
  }
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'main';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'label';
  button.append(icon, label);
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  shadow.append(style, button, menu);
  let state: VideoUiState = 'idle';
  let handler: (() => void) | null = null;

  const onOutside = (event: Event) => {
    if (!event.composedPath().includes(host)) {
      closeMenu();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeMenu();
      button.focus();
    }
  };

  function closeMenu(): void {
    if (menu.hidden) {
      return;
    }
    menu.hidden = true;
    menu.replaceChildren();
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function placeMenu(): void {
    menu.removeAttribute('data-above');
    const box = menu.getBoundingClientRect();
    if (box.bottom > window.innerHeight && host.getBoundingClientRect().top > box.height) {
      menu.setAttribute('data-above', '');
    }
  }

  function openMenu(title: string, items: VideoMenuItem[]): void {
    const heading = document.createElement('div');
    heading.className = 'title';
    heading.textContent = title;
    const rows = items.map((item) =>
      menuRow(item, (picked) => {
        closeMenu();
        picked.pick();
      }),
    );
    menu.replaceChildren(heading, ...rows);
    menu.hidden = false;
    placeMenu();
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    const [first] = rows;
    if (first) {
      first.focus();
    }
  }

  function syncPopover(visible: boolean): void {
    if (!host.isConnected || !host.hasAttribute('popover')) {
      return;
    }
    const open = host.matches(':popover-open');
    if (visible && !open) {
      host.showPopover();
    }
    if (!visible && open) {
      host.hidePopover();
    }
  }

  for (const type of ['mousedown', 'auxclick', 'pointerdown'] as const) {
    host.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
  for (const type of ['mouseup', 'pointerup', 'dblclick'] as const) {
    host.addEventListener(type, (event) => {
      event.stopPropagation();
    });
  }
  host.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (state !== 'idle' && ACTIVE_STATES.has(state) && handler) {
      handler();
    }
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
      if (!ACTIVE_STATES.has(next)) {
        closeMenu();
      }
      onStateChange?.();
    },
    state: () => state,
    onActivate(next) {
      handler = next;
    },
    toggleMenu(title, items) {
      if (menu.hidden) {
        openMenu(title, items);
        return;
      }
      closeMenu();
    },
    show(visible) {
      host.toggleAttribute('data-visible', visible);
      if (!visible) {
        closeMenu();
      }
      syncPopover(visible);
    },
    remove: () => {
      closeMenu();
      host.remove();
    },
  };
}
