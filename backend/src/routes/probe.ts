import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import type { AccessibilityService } from '../services/accessibility-service.js';
import { normalizeDomain } from '../utils/domain.js';
import { sameToken } from '../utils/token.js';

const probeSchema = {
  body: {
    type: 'object',
    required: ['domains'],
    additionalProperties: false,
    properties: {
      domains: { type: 'array', minItems: 1, maxItems: config.maxDomainsPerRequest, items: { type: 'string', minLength: 1, maxLength: 253 } },
    },
  },
} as const;

export const probeRoutes: FastifyPluginAsync<{ service: AccessibilityService; token: string }> = async (app, { service, token }) => {
  app.post<{ Body: { domains: string[] } }>('/probe', { schema: probeSchema }, async (request, reply) => {
    if (!sameToken(request.headers['x-probe-token'], token)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const domains = [...new Set(request.body.domains.map(normalizeDomain).filter((domain): domain is string => domain !== null))];
    return { results: await service.check(domains) };
  });
};
