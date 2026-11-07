import type { FastifyReply } from 'fastify';
import { MediaFetchError } from '../services/media/safe-http.js';
import { MediaUnavailable } from '../services/media/types.js';

export interface Failure {
  status: number;
  error: string;
  message: string;
}

export const LOOKUP_CACHE_MS = 2 * 60_000;
export const LOOKUP_CACHE_SIZE = 500;
export const NO_RATE_LIMIT = { rateLimit: false } as const;

export const linkBodySchema = {
  body: {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: { url: { type: 'string', minLength: 4, maxLength: 4096 } },
  },
} as const;

const ticket = { type: 'string', minLength: 10, maxLength: 16_384 } as const;

export const ticketQuerySchema = {
  querystring: { type: 'object', required: ['t'], properties: { t: ticket } },
} as const;

export const imageQuerySchema = {
  querystring: { type: 'object', required: ['t'], properties: { t: ticket, download: { type: 'string', enum: ['1'] } } },
} as const;

const FETCH_STATUS: Record<MediaFetchError['failure'], number> = {
  invalid_url: 400,
  unsafe_address: 400,
  dns: 422,
  http_error: 422,
  too_large: 413,
  timeout: 504,
  network: 502,
};

export function failureOf(error: unknown): Failure {
  if (error instanceof MediaUnavailable) {
    return { status: error.reason === 'restricted' ? 403 : 422, error: error.reason, message: error.message };
  }
  if (error instanceof MediaFetchError) {
    return { status: FETCH_STATUS[error.failure], error: error.failure, message: error.message };
  }
  return { status: 502, error: 'failed', message: 'This video could not be read. Try again or pick another quality.' };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function wantsHtml(accept: string | undefined): boolean {
  return typeof accept === 'string' && accept.includes('text/html');
}

export function sendFailure(reply: FastifyReply, failure: Failure, html: boolean): FastifyReply {
  reply.code(failure.status);
  if (!html) {
    return reply.send({ error: failure.error, message: failure.message });
  }
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Download did not start</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.4rem">Download did not start</h1><p>${escapeHtml(failure.message)}</p><p style="color:#666">Go back to the downloader and look up the video again.</p></body></html>`;
  return reply.type('text/html; charset=utf-8').send(page);
}

export function disposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
