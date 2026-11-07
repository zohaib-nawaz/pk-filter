import { postMedia, thumbnailHref } from './media-api';

export interface ThumbnailItem {
  key: string;
  label: string;
  src: string;
  href: string;
}

export interface ThumbnailLookup {
  title: string;
  summary: string;
  items: ThumbnailItem[];
}

interface ThumbnailBody {
  title?: unknown;
  source?: unknown;
  author?: unknown;
  thumbnails?: unknown;
}

interface ThumbnailEntry {
  label: string;
  token: string;
}

const SOURCE_TEXT: Record<string, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  page: 'Found on the page',
  image: 'Image link',
};

function isEntry(value: unknown): value is ThumbnailEntry {
  const item = value as Partial<ThumbnailEntry> | null;
  return !!item && typeof item.label === 'string' && typeof item.token === 'string' && item.token.length > 0;
}

function summaryOf(body: ThumbnailBody, count: number): string {
  const parts: string[] = [];
  if (typeof body.source === 'string' && body.source in SOURCE_TEXT) {
    parts.push(SOURCE_TEXT[body.source] as string);
  }
  if (typeof body.author === 'string' && body.author) {
    parts.push(`by ${body.author}`);
  }
  parts.push(`${count} ${count === 1 ? 'size' : 'sizes'}`);
  return parts.join(' · ');
}

export async function findThumbnails(url: string): Promise<ThumbnailLookup> {
  const body = await postMedia<ThumbnailBody>('thumbnails', url);
  const entries = Array.isArray(body.thumbnails) ? body.thumbnails.filter(isEntry) : [];
  return {
    title: typeof body.title === 'string' && body.title ? body.title : 'Video',
    summary: summaryOf(body, entries.length),
    items: entries.map((entry, index) => ({
      key: `${index}-${entry.label}`,
      label: entry.label,
      src: thumbnailHref(entry.token, false),
      href: thumbnailHref(entry.token, true),
    })),
  };
}
