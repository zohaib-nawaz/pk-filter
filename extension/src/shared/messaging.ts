import type { Request, ResponseMap } from '../core/messages';

export async function sendRequest<T extends Request>(request: T): Promise<ResponseMap[T['type']] | null> {
  try {
    return ((await chrome.runtime.sendMessage(request)) as ResponseMap[T['type']] | undefined) ?? null;
  } catch {
    return null;
  }
}
