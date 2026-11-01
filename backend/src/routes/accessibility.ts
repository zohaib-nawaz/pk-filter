import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import type { AccessibilityService } from '../services/accessibility-service.js';
import { normalizeDomain } from '../utils/domain.js';

interface CheckBody {
  domains: string[];
  country?: string;
}

const checkSchema = {
  body: {
    type: 'object',
    required: ['domains'],
    additionalProperties: false,
    properties: {
      domains: {
        type: 'array',
        minItems: 1,
        maxItems: config.maxDomainsPerRequest,
        items: { type: 'string', minLength: 1, maxLength: 253 },
      },
      country: { type: 'string', enum: ['PK'] },
    },
  },
} as const;

export const accessibilityRoutes: FastifyPluginAsync<{ service: AccessibilityService }> = async (app, { service }) => {
  app.post<{ Body: CheckBody }>('/check', { schema: checkSchema }, async (request) => {
    const accepted = new Set<string>();
    const rejected: string[] = [];
    for (const input of request.body.domains) {
      const domain = normalizeDomain(input);
      if (domain) accepted.add(domain);
      else rejected.push(input);
    }
    const results = await service.check([...accepted]);
    return { results, rejected };
  });
};
