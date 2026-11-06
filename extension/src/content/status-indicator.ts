import { brandId } from '../core/brand';
import { archiveUrl, needsAlternatives } from '../core/alternatives';
import { countryName } from '../core/countries';
import { describeEvidence } from '../core/evidence';
import { isSplitDecision, networksOf } from '../core/networks';
import { formatConfidence, formatNetwork, formatRelative } from '../core/format';
import { STATUS_META } from '../core/status-meta';
import type { CheckResult, DisplayStatus } from '../core/types';

export const INDICATOR_TAG = brandId('badge');
export const TOOLTIP_TAG = brandId('tooltip');

export interface Indicator {
  element: HTMLElement;
  update(status: DisplayStatus, result: CheckResult | null): void;
  remove(): void;
}

const BADGE_STYLES = `
:host { all: initial; display: inline-block; margin-left: 8px; vertical-align: middle; }
.pill { display: inline-flex; align-items: center; gap: 5px; padding: 0 7px; height: 18px; border: 1px solid #dadce0;
  border-radius: 9px; font: 500 11px/18px Arial, Helvetica, sans-serif; color: #3c4043; background: #fff; cursor: default; white-space: nowrap; }
.dot { display: block; width: 7px; height: 7px; border-radius: 50%; flex: none; }
:host([data-clickable]) .pill { cursor: pointer; }
@media (prefers-color-scheme: dark) {
  .pill { background: #303134; border-color: #5f6368; color: #e8eaed; }
}`;

const TOOLTIP_STYLES = `
:host { all: initial; }
.tip { position: fixed; z-index: 2147483000; width: 260px; padding: 10px 12px; border: 1px solid #dadce0; border-radius: 8px;
  background: #fff; color: #202124; box-shadow: 0 4px 16px rgba(0,0,0,.12); font: 12px/1.45 Arial, Helvetica, sans-serif;
  pointer-events: none; }
.tip[hidden] { display: none; }
.row { display: flex; justify-content: space-between; gap: 12px; }
.key { color: #5f6368; flex: none; }
.value { text-align: right; overflow-wrap: anywhere; }
.title { font-weight: 700; margin-bottom: 2px; }
.desc { color: #5f6368; margin-bottom: 8px; }
.evidence { margin: 8px 0 0; padding: 8px 0 0 14px; border-top: 1px solid #ececec; color: #3c4043; }
.networks { margin-top: 8px; padding-top: 8px; border-top: 1px solid #ececec; }
.section { font-weight: 700; margin-bottom: 2px; }
.hint { margin-top: 8px; color: #1a73e8; }
@media (prefers-color-scheme: dark) {
  .tip { background: #303134; border-color: #5f6368; color: #e8eaed; }
  .key, .desc { color: #9aa0a6; }
  .evidence { border-color: #5f6368; color: #e8eaed; }
}`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function row(key: string, value: string): HTMLElement {
  const container = element('div', 'row');
  container.append(element('span', 'key', key), element('span', 'value', value));
  return container;
}

function testLocation(result: CheckResult): string {
  const country = countryName(result.country);
  if (result.network.city && result.network.city !== 'unknown') {
    return `${country} (${result.network.city})`;
  }
  return country;
}

function ariaPrefix(result: CheckResult | null): string {
  if (!result) {
    return 'Site accessibility';
  }
  return `Accessibility in ${countryName(result.country)}`;
}

function tooltipRows(status: DisplayStatus, result: CheckResult | null): HTMLElement[] {
  const meta = STATUS_META[status];
  const rows: HTMLElement[] = [element('div', 'title', meta.label), element('div', 'desc', meta.description)];
  if (!result) {
    return rows;
  }
  const location = testLocation(result);
  rows.push(
    row('Last checked', formatRelative(result.lastChecked)),
    row('Test location', location),
    row('Method', result.method),
    row('Confidence', formatConfidence(result.confidence)),
    row('Network', formatNetwork(result.network)),
  );
  if (result.localCheck) {
    rows.push(row('Your connection', result.localCheck === 'reachable' ? 'Opens' : 'Did not open'));
  }
  const networks = networksOf(result);
  if (networks.length > 1) {
    const list = element('div', 'networks');
    list.append(element('div', 'section', 'By network'));
    for (const network of networks) {
      list.append(row(network.isp, STATUS_META[network.status].label));
    }
    rows.push(list);
  }
  const evidence = describeEvidence(result.evidence);
  if (evidence.length) {
    const list = element('ul', 'evidence');
    for (const item of evidence) {
      list.append(element('li', '', item));
    }
    rows.push(list);
  }
  if (needsAlternatives(status)) {
    rows.push(element('div', 'hint', 'Click the badge to open an archived copy'));
  }
  return rows;
}

function labelFor(status: DisplayStatus, result: CheckResult | null): string {
  return result && isSplitDecision(result) ? 'Blocked on some ISPs' : STATUS_META[status].label;
}

const TOOLTIP_WIDTH = 260;
const VIEWPORT_MARGIN = 8;
let tooltipBox: HTMLElement | null = null;

function shadowHost(tag: string, styles: string): { host: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement(tag);
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = styles;
  shadow.append(style);
  return { host, shadow };
}

function tooltip(): HTMLElement {
  if (tooltipBox?.isConnected) {
    return tooltipBox;
  }
  const { host, shadow } = shadowHost(TOOLTIP_TAG, TOOLTIP_STYLES);
  tooltipBox = element('div', 'tip');
  tooltipBox.setAttribute('role', 'tooltip');
  tooltipBox.hidden = true;
  shadow.append(tooltipBox);
  document.body.append(host);
  return tooltipBox;
}

function showTooltip(target: HTMLElement, rows: HTMLElement[]): void {
  const box = tooltip();
  box.replaceChildren(...rows);
  box.hidden = false;
  const rect = target.getBoundingClientRect();
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN * 3));
  const below = rect.bottom + 6;
  const fitsBelow = below + box.offsetHeight + VIEWPORT_MARGIN <= window.innerHeight;
  box.style.left = `${left}px`;
  box.style.top = `${fitsBelow ? below : Math.max(VIEWPORT_MARGIN, rect.top - box.offsetHeight - 6)}px`;
}

export function hideTooltip(): void {
  if (tooltipBox) {
    tooltipBox.hidden = true;
  }
}

export function createIndicator(): Indicator {
  const { host, shadow } = shadowHost(INDICATOR_TAG, BADGE_STYLES);
  const pill = element('span', 'pill');
  const dot = element('span', 'dot');
  const label = element('span', 'label');
  pill.append(dot, label);
  shadow.append(pill);
  let current: { status: DisplayStatus; result: CheckResult | null } = { status: 'checking', result: null };

  for (const type of ['mousedown', 'auxclick'] as const) {
    host.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
  host.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (current.result && needsAlternatives(current.status)) {
      window.open(archiveUrl(current.result.domain), '_blank', 'noopener,noreferrer');
    }
  });
  host.addEventListener('mouseenter', () => showTooltip(host, tooltipRows(current.status, current.result)));
  host.addEventListener('mouseleave', hideTooltip);

  return {
    element: host,
    update(status, result) {
      current = { status, result };
      const meta = STATUS_META[status];
      const text = labelFor(status, result);
      dot.style.background = meta.color;
      label.textContent = text;
      host.toggleAttribute('data-clickable', Boolean(result) && needsAlternatives(status));
      host.setAttribute('aria-label', `${ariaPrefix(result)}: ${text}. ${meta.description}`);
    },
    remove: () => host.remove(),
  };
}
