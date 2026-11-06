import { brandId } from '../core/brand';
export const NOTICE_TAG = brandId('notice');

const STYLES = `
:host { all: initial; display: block; margin: 0 0 16px; }
.bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid #dadce0; border-radius: 8px;
  font: 13px/1.4 Arial, Helvetica, sans-serif; color: #3c4043; background: #f8f9fa; }
button { margin-left: auto; border: 0; background: none; color: #1a0dab; font: inherit; cursor: pointer; padding: 0; }
button:hover { text-decoration: underline; }
@media (prefers-color-scheme: dark) {
  .bar { background: #303134; border-color: #5f6368; color: #e8eaed; }
  button { color: #8ab4f8; }
}`;

export interface HiddenNotice {
  update(hiddenCount: number): void;
  remove(): void;
}

export function createHiddenNotice(onShowAll: () => void, anchorOf: () => Element | null): HiddenNotice {
  const host = document.createElement(NOTICE_TAG);
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const bar = document.createElement('div');
  bar.className = 'bar';
  const text = document.createElement('span');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Show all results';
  button.addEventListener('click', onShowAll);
  bar.append(text, button);
  shadow.append(style, bar);

  return {
    update(hiddenCount) {
      if (hiddenCount === 0) {
        host.remove();
        return;
      }
      text.textContent = `${hiddenCount} result${hiddenCount === 1 ? '' : 's'} hidden by the accessibility filter.`;
      const anchor = anchorOf();
      if (!host.isConnected && anchor?.parentElement) {
        anchor.parentElement.insertBefore(host, anchor);
      }
    },
    remove: () => host.remove(),
  };
}
