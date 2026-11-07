import { fetchText, MediaFetchError } from './safe-http.js';
import type { MediaUnavailable } from './types.js';

export type OEmbedData = Record<string, unknown>;

const OEMBED_LIMIT = 256 * 1024;

export function readText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.trim();
}

export function readUrl(value: unknown): string | null {
  const raw = readText(value);
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function fetchOEmbed(endpoint: string, notFound: () => MediaUnavailable): Promise<OEmbedData> {
  let body: string;
  try {
    body = (await fetchText(endpoint, OEMBED_LIMIT)).text;
  } catch (error) {
    if (error instanceof MediaFetchError && error.failure !== 'http_error') {
      throw error;
    }
    throw notFound();
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as OEmbedData;
    }
  } catch {
    throw notFound();
  }
  throw notFound();
}
