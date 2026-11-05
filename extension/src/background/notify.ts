export function notify(id: string, title: string, message: string): void {
  if (!chrome.notifications) {
    return;
  }
  chrome.notifications.create(`pkaf-${id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
  });
}
