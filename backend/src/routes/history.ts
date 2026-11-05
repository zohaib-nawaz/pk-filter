import type { FastifyPluginAsync } from 'fastify';
import type { CheckRepository } from '../database/repository.js';
import { summarizeHistory } from '../services/history.js';
import { normalizeDomain } from '../utils/domain.js';

const HISTORY_DAYS = 30;

const historySchema = {
  querystring: {
    type: 'object',
    required: ['domain'],
    properties: { domain: { type: 'string', minLength: 1, maxLength: 253 }, country: { type: 'string', pattern: '^[A-Za-z]{2}$' } },
  },
} as const;

export const historyRoutes: FastifyPluginAsync<{ repository: CheckRepository; country: string }> = async (app, { repository, country }) => {
  app.get<{ Querystring: { domain: string; country?: string } }>('/history', { schema: historySchema }, async (request, reply) => {
    const domain = normalizeDomain(request.query.domain);
    if (!domain) {
      return reply.code(400).send({ error: 'invalid_domain' });
    }
    const asked = request.query.country ? request.query.country.toUpperCase() : country;
    if (asked !== country) {
      return { domain, available: false, days: [], blockedSince: null };
    }
    const rows = await repository.history(domain, HISTORY_DAYS);
    if (rows === null) {
      return { domain, available: false, days: [], blockedSince: null };
    }
    return { domain, available: true, windowDays: HISTORY_DAYS, ...summarizeHistory(rows) };
  });
};
