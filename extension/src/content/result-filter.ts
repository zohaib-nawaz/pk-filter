const HIDDEN_ATTRIBUTE = 'data-pkaf-hidden';
const STYLE_ID = 'pkaf-filter-style';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `[${HIDDEN_ATTRIBUTE}] { display: none !important; }`;
  document.head.append(style);
}

export function setHidden(container: HTMLElement, hidden: boolean): void {
  if (hidden) ensureStyle();
  container.toggleAttribute(HIDDEN_ATTRIBUTE, hidden);
}

export function unhideAll(root: ParentNode): void {
  for (const element of root.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)) element.removeAttribute(HIDDEN_ATTRIBUTE);
}
