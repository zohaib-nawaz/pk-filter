import { brandId } from '../core/brand';
import { domainFromUrl } from '../core/site-view';
import { siteReportQuery } from '../core/site-report';

const LINK_ITEM = brandId('check-link');
const PAGE_ITEM = brandId('check-page');
const WINDOW_SIZE = { width: 400, height: 560 };
let watching = false;

export function createContextMenus(): void {
  if (!chrome.contextMenus) {
    return;
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: LINK_ITEM, title: 'Check if this link is blocked', contexts: ['link'] });
    chrome.contextMenus.create({ id: PAGE_ITEM, title: 'Check if this site is blocked', contexts: ['page'] });
  });
}

async function openCheck(info: chrome.contextMenus.OnClickData): Promise<void> {
  const target = info.menuItemId === LINK_ITEM ? info.linkUrl : info.pageUrl;
  const domain = domainFromUrl(target);
  if (!domain) {
    return;
  }
  const url = chrome.runtime.getURL(siteReportQuery({ domain, mode: 'check', url: target || null, error: null }));
  await chrome.windows.create({ url, type: 'popup', ...WINDOW_SIZE });
}

export function watchContextMenus(): void {
  if (watching || !chrome.contextMenus) {
    return;
  }
  watching = true;
  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === LINK_ITEM || info.menuItemId === PAGE_ITEM) {
      void openCheck(info).catch(() => undefined);
    }
  });
}
