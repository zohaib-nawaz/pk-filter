import { Readable } from 'node:stream';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { TtlCache } from '../utils/ttl-cache.js';
import { openDownload, type ByteRange, type DownloadStream } from '../services/media/download.js';
import { inspectMediaUrl } from '../services/media/inspect.js';
import { createDownloadSlots, type DownloadSlots } from '../services/media/slots.js';
import { readTicket, signTicket, type DownloadTicket } from '../services/media/token.js';
import type { FormatRef, MediaFormat, MediaInspection } from '../services/media/types.js';
import { disposition, failureOf, linkBodySchema, LOOKUP_CACHE_MS, LOOKUP_CACHE_SIZE, NO_RATE_LIMIT, sendFailure, ticketQuerySchema, wantsHtml } from './media-replies.js';

export interface MediaRouteOptions {
  secret: string;
  metaToken?: string | null;
  maxBytes: number;
  slots: DownloadSlots;
  previewSlots?: DownloadSlots;
  ticketTtlMs: number;
  now?: () => number;
}

const RANGE = /^bytes=(\d+)-(\d*)$/;

async function* startingWith(first: Uint8Array, rest: AsyncIterator<Uint8Array>): AsyncGenerator<Uint8Array> {
  yield first;
  for (let next = await rest.next(); !next.done; next = await rest.next()) {
    yield next.value;
  }
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

function downloadName(title: string, format: MediaFormat): string {
  if (format.audio === 'only') {
    return `${title} (audio)`;
  }
  if (format.height !== null) {
    return `${title} (${format.label})`;
  }
  return title;
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

  app.post<{ Body: { url: string } }>('/media/formats', { schema: linkBodySchema, logLevel: 'warn' }, async (request, reply) => {
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
        embed: inspection.embed ? inspection.embed : null,
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

  const streamOptions = { schema: ticketQuerySchema, logLevel: 'warn', exposeHeadRoute: false, config: NO_RATE_LIMIT } as const;

  app.get<{ Querystring: { t: string } }>('/media/download', streamOptions, (request, reply) => serveMedia(request, reply, false));

  app.get<{ Querystring: { t: string } }>('/media/preview', streamOptions, (request, reply) => serveMedia(request, reply, true));
};
