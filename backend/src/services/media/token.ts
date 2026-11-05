import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { TicketRef } from './types.js';

export interface DownloadTicket {
  ref: TicketRef;
  title: string;
  exp: number;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFor(secret: string): Buffer {
  return createHash('sha256').update(`media-ticket:${secret}`).digest();
}

export function signTicket(ticket: DownloadTicket, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const sealed = Buffer.concat([cipher.update(JSON.stringify(ticket), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString('base64url');
}

function isTicket(value: unknown): value is DownloadTicket {
  const ticket = value as Partial<DownloadTicket> | null;
  return !!ticket && typeof ticket.title === 'string' && typeof ticket.exp === 'number' && !!ticket.ref && typeof ticket.ref === 'object';
}

function open(token: string, secret: string): string | null {
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length <= IV_BYTES + TAG_BYTES) {
    return null;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), bytes.subarray(0, IV_BYTES));
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function readTicket(token: string, secret: string, now: number): DownloadTicket | null {
  const text = open(token, secret);
  if (!text) {
    return null;
  }
  try {
    const ticket: unknown = JSON.parse(text);
    if (!isTicket(ticket) || ticket.exp < now) {
      return null;
    }
    return ticket;
  } catch {
    return null;
  }
}
