import { isRestrictedHost } from '../../../../extension/src/core/restricted-sites';
import { fetchOEmbed, readText, readUrl } from './oembed.js';
import { pageThumbnails, pageTitle, type PageImage } from './page-sources.js';
import { contentTypeOf, expectOk, MediaFetchError, openSafe, readBody, safeMediaUrl } from './safe-http.js';
import { tiktokInspection } from './tiktok.js';
import { MediaUnavailable } from './types.js';
import { isFacebookVideo, platformOf, youtubeId, type VideoPlatform } from './video-links.js';

export type ThumbnailSource = VideoPlatform | 'page' | 'image';

export interface ThumbnailResult {
  title: string;
  source: ThumbnailSource;
  author: string | null;
  referer: string | null;
  images: PageImage[];
}

export interface ThumbnailOptions {
  metaToken: string | null;
}

type Provider = (url: URL, options: ThumbnailOptions) => Promise<ThumbnailResult>;

const PAGE_LIMIT = 3 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 8_000;
const META_GRAPH = 'https://graph.facebook.com/v22.0';
const YOUTUBE_IMAGES = 'https://i.ytimg.com/vi';
const YOUTUBE_SIZES = [
  { file: 'maxresdefault', label: 'HD', optional: true },
  { file: 'sddefault', label: 'Standard', optional: true },
  { file: 'hqdefault', label: 'High', optional: false },
  { file: 'mqdefault', label: 'Medium', optional: false },
  { file: 'default', label: 'Small', optional: false },
];
const VIMEO_SIZE = /_(\d+)(?:x\d+)?$/;
const VIMEO_WIDTHS = [1280, 640, 295];
const PLATFORM_NAMES: Record<VideoPlatform, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
};

function notFound(platform: VideoPlatform): () => MediaUnavailable {
  return () => new MediaUnavailable('not_found', `This ${PLATFORM_NAMES[platform]} video could not be found. It may be private or removed.`);
}

function onlyImage(url: string | null, label: string, platform: VideoPlatform): PageImage[] {
  if (!url) {
    throw new MediaUnavailable('not_found', `${PLATFORM_NAMES[platform]} did not share a thumbnail for this video.`);
  }
  return [{ label, url }];
}

async function exists(url: string): Promise<boolean> {
  try {
    const response = await openSafe(url, { timeoutMs: PROBE_TIMEOUT_MS });
    response.body.destroy();
    return response.status === 200;
  } catch {
    return false;
  }
}

async function youtube(url: URL): Promise<ThumbnailResult> {
  const id = youtubeId(url);
  if (!id) {
    throw new MediaUnavailable('not_found', 'This YouTube link does not point to a video.');
  }
  const watch = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
  const images = YOUTUBE_SIZES.map((size) => ({ ...size, url: `${YOUTUBE_IMAGES}/${id}/${size.file}.jpg` }));
  const [data, available] = await Promise.all([
    fetchOEmbed(`https://www.youtube.com/oembed?format=json&url=${watch}`, notFound('youtube')),
    Promise.all(images.map((image) => (image.optional ? exists(image.url) : true))),
  ]);
  return {
    title: readText(data.title) || 'YouTube video',
    source: 'youtube',
    author: readText(data.author_name),
    referer: null,
    images: images.filter((_, index) => available[index]).map(({ label, url: image }) => ({ label, url: image, trimBars: true })),
  };
}

function vimeoSizes(thumbnail: string | null): PageImage[] {
  const url = thumbnail ? new URL(thumbnail) : null;
  const match = url ? VIMEO_SIZE.exec(url.pathname) : null;
  if (!url || !match) {
    return onlyImage(thumbnail, 'Largest', 'vimeo');
  }
  const largest = Number(match[1]);
  return [largest, ...VIMEO_WIDTHS.filter((width) => width < largest)].map((width) => {
    const sized = new URL(url);
    sized.pathname = url.pathname.replace(VIMEO_SIZE, `_${width}`);
    return { label: `${width}px wide`, url: sized.toString() };
  });
}

async function vimeo(url: URL): Promise<ThumbnailResult> {
  const data = await fetchOEmbed(`https://vimeo.com/api/oembed.json?width=1920&url=${encodeURIComponent(url.toString())}`, notFound('vimeo'));
  return { title: readText(data.title) || 'Vimeo video', source: 'vimeo', author: readText(data.author_name), referer: null, images: vimeoSizes(readUrl(data.thumbnail_url)) };
}

async function dailymotion(url: URL): Promise<ThumbnailResult> {
  const data = await fetchOEmbed(`https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(url.toString())}`, notFound('dailymotion'));
  return {
    title: readText(data.title) || 'Dailymotion video',
    source: 'dailymotion',
    author: readText(data.author_name),
    referer: null,
    images: onlyImage(readUrl(data.thumbnail_url), 'Largest', 'dailymotion'),
  };
}

async function tiktok(url: URL): Promise<ThumbnailResult> {
  const inspection = await tiktokInspection(url.toString());
  return {
    title: inspection.title,
    source: 'tiktok',
    author: inspection.embed ? inspection.embed.author : null,
    referer: null,
    images: onlyImage(inspection.thumbnail, 'Cover', 'tiktok'),
  };
}

function metaEndpoint(url: URL, platform: 'instagram' | 'facebook'): string {
  if (platform === 'instagram') {
    return 'instagram_oembed';
  }
  return isFacebookVideo(url) ? 'oembed_video' : 'oembed_post';
}

function meta(platform: 'instagram' | 'facebook'): Provider {
  return async (url, options) => {
    if (!options.metaToken) {
      throw new MediaUnavailable('unsupported', `${PLATFORM_NAMES[platform]} only shares thumbnails through its official API, which is not connected on this server yet.`);
    }
    const query = `url=${encodeURIComponent(url.toString())}&fields=title,author_name,thumbnail_url&access_token=${encodeURIComponent(options.metaToken)}`;
    const data = await fetchOEmbed(`${META_GRAPH}/${metaEndpoint(url, platform)}?${query}`, notFound(platform));
    return {
      title: readText(data.title) || `${PLATFORM_NAMES[platform]} video`,
      source: platform,
      author: readText(data.author_name),
      referer: null,
      images: onlyImage(readUrl(data.thumbnail_url), 'Cover', platform),
    };
  };
}

function refuseRestricted(url: URL): void {
  if (isRestrictedHost(url.hostname)) {
    throw new MediaUnavailable('restricted', 'This website does not share video thumbnails publicly, so it is not supported');
  }
}

function lastSegment(url: URL): string {
  return url.pathname.split('/').filter(Boolean).at(-1) || 'image';
}

async function page(url: URL): Promise<ThumbnailResult> {
  refuseRestricted(url);
  const response = await openSafe(url.toString());
  expectOk(response);
  const finalUrl = new URL(response.finalUrl);
  const type = contentTypeOf(response);
  try {
    refuseRestricted(finalUrl);
    if (type.startsWith('video/') || type.startsWith('audio/')) {
      throw new MediaUnavailable('unsupported', 'This link is a video file, which has no separate thumbnail. Use the frame extractor to save any frame from it.');
    }
  } catch (error) {
    response.body.destroy();
    throw error;
  }
  if (type.startsWith('image/')) {
    response.body.destroy();
    return { title: lastSegment(finalUrl), source: 'image', author: null, referer: null, images: [{ label: 'Image', url: finalUrl.toString() }] };
  }
  const html = (await readBody(response, PAGE_LIMIT)).toString('utf8');
  const images = pageThumbnails(html, finalUrl.toString());
  if (images.length === 0) {
    throw new MediaUnavailable('not_found', 'No video thumbnail was found on this page.');
  }
  return { title: pageTitle(html) || finalUrl.hostname.replace(/^www\./, ''), source: 'page', author: null, referer: finalUrl.toString(), images };
}

const PROVIDERS: Record<VideoPlatform, Provider> = {
  youtube,
  vimeo,
  dailymotion,
  tiktok,
  instagram: meta('instagram'),
  facebook: meta('facebook'),
};

export async function findThumbnails(raw: string, options: ThumbnailOptions): Promise<ThumbnailResult> {
  const url = safeMediaUrl(raw);
  if (!url) {
    throw new MediaFetchError('invalid_url', 'This is not a valid public web address');
  }
  const platform = platformOf(url);
  if (!platform) {
    return page(url);
  }
  return PROVIDERS[platform](url, options);
}
