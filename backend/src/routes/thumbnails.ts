import { Readable } from 'node:stream';
import type { FastifyPluginAsync } from 'fastify';
import { TtlCache } from '../utils/ttl-cache.js';
import { limited } from '../services/media/download.js';
import { trimBars } from '../services/media/image-trim.js';
import { bodyChunks, contentTypeOf, expectOk, headerValue, openSafe, readBody } from '../services/media/safe-http.js';
import { findThumbnails, type ThumbnailResult } from '../services/media/thumbnails.js';
import { readTicket, signTicket } from '../services/media/token.js';
import { disposition, failureOf, imageQuerySchema, linkBodySchema, LOOKUP_CACHE_MS, LOOKUP_CACHE_SIZE, NO_RATE_LIMIT, sendFailure } from './media-replies.js';

export interface ThumbnailRouteOptions {
  secret: string;
  ticketTtlMs: number;
  metaToken?: string | null;
  now?: () => number;
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15_000;
const IMAGE_CACHE = 'private, max-age=3600';
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export const thumbnailRoutes: FastifyPluginAsync<ThumbnailRouteOptions> = async (app, options) => {
  const now = options.now || Date.now;
  const lookups = new TtlCache<string, ThumbnailResult>(LOOKUP_CACHE_SIZE, now);
  const metaToken = options.metaToken || null;

  async function lookup(url: string): Promise<ThumbnailResult> {
    const cached = lookups.get(url);
    if (cached) {
      return cached;
    }
    const result = await findThumbnails(url, { metaToken });
    lookups.set(url, result, LOOKUP_CACHE_MS);
    return result;
  }

  app.post<{ Body: { url: string } }>('/media/thumbnails', { schema: linkBodySchema, logLevel: 'warn' }, async (request, reply) => {
    try {
      const result = await lookup(request.body.url.trim());
      const exp = now() + options.ticketTtlMs;
      const referer = result.referer || undefined;
      return {
        title: result.title,
        source: result.source,
        author: result.author,
        thumbnails: result.images.map((image) => ({
          label: image.label,
          token: signTicket({ ref: { kind: 'thumbnail', url: image.url, referer, trimBars: image.trimBars }, title: `${result.title} (${image.label})`, exp }, options.secret),
        })),
      };
    } catch (error) {
      const failure = failureOf(error);
      if (failure.error === 'failed') {
        request.log.error({ err: error }, 'thumbnail_lookup_failed');
      }
      return sendFailure(reply, failure, false);
    }
  });

  const imageOptions = { schema: imageQuerySchema, logLevel: 'warn', exposeHeadRoute: false, config: NO_RATE_LIMIT } as const;

  app.get<{ Querystring: { t: string; download?: '1' } }>('/media/thumbnail', imageOptions, async (request, reply) => {
    const ticket = readTicket(request.query.t, options.secret, now());
    if (!ticket || ticket.ref.kind !== 'thumbnail') {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const response = await openSafe(ticket.ref.url, { referer: ticket.ref.referer, timeoutMs: IMAGE_TIMEOUT_MS });
      expectOk(response);
      const type = contentTypeOf(response);
      const extension = IMAGE_EXTENSIONS[type];
      if (!extension || Number(headerValue(response.headers['content-length'])) > IMAGE_MAX_BYTES) {
        response.body.destroy();
        return reply.code(404).send({ error: 'not_found' });
      }
      reply.type(type);
      reply.header('cache-control', IMAGE_CACHE);
      reply.header('content-security-policy', "default-src 'none'");
      if (request.query.download === '1') {
        reply.header('content-disposition', disposition(`${ticket.title}.${extension}`, false));
      }
      if (ticket.ref.trimBars) {
        return reply.send(await trimBars(await readBody(response, IMAGE_MAX_BYTES)));
      }
      return reply.send(Readable.from(limited(bodyChunks(response), IMAGE_MAX_BYTES)));
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
  });
};
