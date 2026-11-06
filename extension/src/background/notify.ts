import { brandId } from '../core/brand';
export function notify(id: string, title: string, message: string): void {
  if (!chrome.notifications) {
    return;
  }
  chrome.notifications.create(brandId(id), {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
  });
}
