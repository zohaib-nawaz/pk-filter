import type { FastifyPluginAsync } from 'fastify';
import type { CheckRepository } from '../database/repository.js';
import { summarizeHistory } from '../services/history.js';
import { normalizeDomain } from '../utils/domain.js';

const HISTORY_DAYS = 30;

const historySchema = {
  querystring: {
    type: 'object',
    required: ['domain'],
    properties: { domain: { type: 'string', minLength: 1, maxLength: 253 } },
  },
} as const;

export const historyRoutes: FastifyPluginAsync<{ repository: CheckRepository }> = async (app, { repository }) => {
  app.get<{ Querystring: { domain: string } }>('/history', { schema: historySchema }, async (request, reply) => {
    const domain = normalizeDomain(request.query.domain);
    if (!domain) {
      return reply.code(400).send({ error: 'invalid_domain' });
    }
    const rows = await repository.history(domain, HISTORY_DAYS);
    if (rows === null) {
      return { domain, available: false, days: [], blockedSince: null };
    }
    return { domain, available: true, windowDays: HISTORY_DAYS, ...summarizeHistory(rows) };
  });
};
