import { Readable } from 'node:stream';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { TtlCache } from '../utils/ttl-cache.js';
import { limited, openDownload, type ByteRange, type DownloadStream } from '../services/media/download.js';
import { inspectMediaUrl } from '../services/media/inspect.js';
import { bodyChunks, expectOk, MediaFetchError, openSafe } from '../services/media/safe-http.js';
import { createDownloadSlots, type DownloadSlots } from '../services/media/slots.js';
import { readTicket, signTicket, type DownloadTicket } from '../services/media/token.js';
import { MediaUnavailable, type FormatRef, type MediaFormat, type MediaInspection } from '../services/media/types.js';

export interface MediaRouteOptions {
  secret: string;
  maxBytes: number;
  slots: DownloadSlots;
  previewSlots?: DownloadSlots;
  ticketTtlMs: number;
  now?: () => number;
}

const formatsSchema = {
  body: {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: { url: { type: 'string', minLength: 4, maxLength: 4096 } },
  },
} as const;

const downloadSchema = {
  querystring: {
    type: 'object',
    required: ['t'],
    properties: { t: { type: 'string', minLength: 10, maxLength: 16_384 } },
  },
} as const;

const LOOKUP_CACHE_MS = 2 * 60_000;
const LOOKUP_CACHE_SIZE = 500;
const RANGE = /^bytes=(\d+)-(\d*)$/;
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;
const THUMBNAIL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

const FETCH_STATUS: Record<MediaFetchError['failure'], number> = {
  invalid_url: 400,
  unsafe_address: 400,
  dns: 422,
  http_error: 422,
  too_large: 413,
  timeout: 504,
  network: 502,
};

interface Failure {
  status: number;
  error: string;
  message: string;
}

function failureOf(error: unknown): Failure {
  if (error instanceof MediaUnavailable) {
    return { status: error.reason === 'restricted' ? 403 : 422, error: error.reason, message: error.message };
  }
  if (error instanceof MediaFetchError) {
    return { status: FETCH_STATUS[error.failure], error: error.failure, message: error.message };
  }
  return { status: 502, error: 'failed', message: 'This video could not be read. Try again or pick another quality.' };
}

async function* startingWith(first: Uint8Array, rest: AsyncIterator<Uint8Array>): AsyncGenerator<Uint8Array> {
  yield first;
  for (let next = await rest.next(); !next.done; next = await rest.next()) {
    yield next.value;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function wantsHtml(accept: string | undefined): boolean {
  return typeof accept === 'string' && accept.includes('text/html');
}

function sendFailure(reply: FastifyReply, failure: Failure, html: boolean): FastifyReply {
  reply.code(failure.status);
  if (!html) {
    return reply.send({ error: failure.error, message: failure.message });
  }
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Download did not start</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.4rem">Download did not start</h1><p>${escapeHtml(failure.message)}</p><p style="color:#666">Go back to the downloader and look up the video again.</p></body></html>`;
  return reply.type('text/html; charset=utf-8').send(page);
}

function rangeFrom(header: string | undefined): ByteRange | null {
  const match = header ? RANGE.exec(header.trim()) : null;
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : null;
  if (end !== null && end < start) {
    return null;
  }
  return { start, end };
}

const PLAYABLE = ['mp4', 'm4v', 'webm', 'mov', 'mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus'];

function playability(format: MediaFormat): number {
  const index = PLAYABLE.indexOf(format.container);
  return index < 0 ? PLAYABLE.length : index;
}

function previewFormat(formats: MediaFormat[]): MediaFormat | undefined {
  const files = formats.filter((format) => format.ref.kind === 'file' && playability(format) < PLAYABLE.length);
  const videos = files.filter((format) => format.audio !== 'only');
  const pool = videos.length > 0 ? videos : files;
  return [...pool].sort((a, b) => playability(a) - playability(b) || (a.sizeBytes || Infinity) - (b.sizeBytes || Infinity))[0];
}

function headerText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
}

function downloadName(title: string, format: MediaFormat): string {
  if (format.audio === 'only') {
    return `${title} (audio)`;
  }
  if (format.height !== null) {
    return `${title} (${format.label})`;
  }
  return title;
}

function disposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function streamHeaders(reply: FastifyReply, download: DownloadStream, inline: boolean): void {
  reply.code(download.status);
  reply.header('content-type', download.contentType);
  reply.header('content-disposition', disposition(download.filename, inline));
  if (download.sizeBytes !== null) {
    reply.header('content-length', String(download.sizeBytes));
  }
  if (download.contentRange) {
    reply.header('content-range', download.contentRange);
  }
  if (download.acceptRanges) {
    reply.header('accept-ranges', 'bytes');
  }
  for (const [name, value] of Object.entries(download.validators)) {
    reply.header(name, value);
  }
}

export const mediaRoutes: FastifyPluginAsync<MediaRouteOptions> = async (app, options) => {
  const now = options.now || Date.now;
  const lookups = new TtlCache<string, MediaInspection>(LOOKUP_CACHE_SIZE, now);

  async function inspect(url: string): Promise<MediaInspection> {
    const cached = lookups.get(url);
    if (cached) {
      return cached;
    }
    const inspection = await inspectMediaUrl(url);
    lookups.set(url, inspection, LOOKUP_CACHE_MS);
    return inspection;
  }

  app.post<{ Body: { url: string } }>('/media/formats', { schema: formatsSchema, logLevel: 'warn' }, async (request, reply) => {
    try {
      const pageUrl = request.body.url.trim();
      const inspection = await inspect(pageUrl);
      const exp = now() + options.ticketTtlMs;
      const sign = (ref: DownloadTicket['ref'], title: string) => signTicket({ ref, title, exp }, options.secret);
      const formats = inspection.formats.map((format) => {
        const { ref, ...visible } = format;
        return { ...visible, token: sign(ref, downloadName(inspection.title, format)) };
      });
      const preview = previewFormat(inspection.formats);
      return {
        title: inspection.title,
        source: inspection.source,
        durationSeconds: inspection.durationSeconds,
        thumbnail: inspection.thumbnail ? sign({ kind: 'thumbnail', url: inspection.thumbnail, referer: pageUrl }, inspection.title) : null,
        preview: preview ? { token: sign(preview.ref, inspection.title), audioOnly: preview.audio === 'only' } : null,
        formats,
      };
    } catch (error) {
      const failure = failureOf(error);
      if (failure.error === 'failed') {
        request.log.error({ err: error }, 'media_lookup_failed');
      }
      return sendFailure(reply, failure, false);
    }
  });

  const previewSlots = options.previewSlots || createDownloadSlots(12, 3);

  async function serveMedia(request: FastifyRequest<{ Querystring: { t: string } }>, reply: FastifyReply, inline: boolean): Promise<FastifyReply> {
    const html = wantsHtml(request.headers.accept);
    const ticket = readTicket(request.query.t, options.secret, now());
    if (!ticket || ticket.ref.kind === 'thumbnail' || (inline && ticket.ref.kind !== 'file')) {
      return sendFailure(reply, { status: 410, error: 'expired', message: 'This download link has expired. Look up the video again.' }, html);
    }
    const ref: FormatRef = ticket.ref;
    const release = (inline ? previewSlots : options.slots).take(request.ip);
    if (!release) {
      return sendFailure(reply, { status: 429, error: 'busy', message: 'Too many downloads are running. Try again in a minute.' }, html);
    }
    const abort = new AbortController();
    request.raw.on('close', () => abort.abort());
    try {
      const download = await openDownload(ref, ticket.title, abort.signal, { maxBytes: options.maxBytes }, rangeFrom(request.headers.range));
      const chunks = download.chunks[Symbol.asyncIterator]();
      const first = await chunks.next();
      const body = Readable.from(first.done ? [] : startingWith(first.value, chunks));
      body.on('close', release);
      reply.raw.once('close', release);
      reply.raw.once('finish', release);
      body.on('error', (error) => {
        release();
        request.log.warn({ err: error }, 'media_download_failed');
      });
      streamHeaders(reply, download, inline);
      return reply.send(body);
    } catch (error) {
      release();
      const failure = failureOf(error);
      if (failure.error === 'failed') {
        request.log.error({ err: error }, 'media_download_failed');
      }
      return sendFailure(reply, failure, html);
    }
  }

  const streamOptions = { schema: downloadSchema, logLevel: 'warn', exposeHeadRoute: false } as const;

  app.get<{ Querystring: { t: string } }>('/media/download', streamOptions, (request, reply) => serveMedia(request, reply, false));

  app.get<{ Querystring: { t: string } }>('/media/preview', streamOptions, (request, reply) => serveMedia(request, reply, true));

  app.get<{ Querystring: { t: string } }>('/media/thumbnail', streamOptions, async (request, reply) => {
    const ticket = readTicket(request.query.t, options.secret, now());
    if (!ticket || ticket.ref.kind !== 'thumbnail') {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const response = await openSafe(ticket.ref.url, { referer: ticket.ref.referer, timeoutMs: 15_000 });
      expectOk(response);
      const type = headerText(response.headers['content-type']).split(';')[0]?.trim().toLowerCase() || '';
      const length = Number(headerText(response.headers['content-length']));
      if (!THUMBNAIL_TYPES.has(type) || length > THUMBNAIL_MAX_BYTES) {
        response.body.destroy();
        return reply.code(404).send({ error: 'not_found' });
      }
      reply.type(type);
      reply.header('content-security-policy', "default-src 'none'");
      return reply.send(Readable.from(limited(bodyChunks(response), THUMBNAIL_MAX_BYTES)));
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
  });
};
