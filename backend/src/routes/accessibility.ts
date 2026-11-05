import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import type { CountryRouter } from '../services/country-router.js';
import type { CountryResolver } from '../services/viewer-country.js';
import { normalizeDomain } from '../utils/domain.js';

interface CheckBody {
  domains: string[];
  country?: string;
}

interface AccessibilityOptions {
  router: CountryRouter;
  resolveCountry: CountryResolver;
}

const COUNTRY_PATTERN = '^(auto|[A-Za-z]{2})$';

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
      country: { type: 'string', pattern: COUNTRY_PATTERN },
    },
  },
} as const;

const whereSchema = {
  querystring: {
    type: 'object',
    properties: { country: { type: 'string', pattern: COUNTRY_PATTERN } },
  },
} as const;

export const accessibilityRoutes: FastifyPluginAsync<AccessibilityOptions> = async (app, { router, resolveCountry }) => {
  const viewerOf = (request: { ip: string; headers: Record<string, string | string[] | undefined> }, requested: string | undefined) =>
    resolveCountry({ requested, ip: request.ip, headerCountry: request.headers['cf-ipcountry'] });

  app.post<{ Body: CheckBody }>('/check', { schema: checkSchema }, async (request) => {
    const accepted = new Set<string>();
    const rejected: string[] = [];
    for (const input of request.body.domains) {
      const domain = normalizeDomain(input);
      if (domain) {
        accepted.add(domain);
      } else {
        rejected.push(input);
      }
    }
    const viewer = viewerOf(request, request.body.country);
    const results = await router.forCountry(viewer.country).check([...accepted]);
    return { results, rejected, country: viewer.country, countrySource: viewer.source, measuredBy: router.measuredBy(viewer.country) };
  });

  app.get<{ Querystring: { country?: string } }>('/whereami', { schema: whereSchema }, async (request) => {
    const viewer = viewerOf(request, request.query.country);
    return { country: viewer.country, source: viewer.source, measuredBy: router.measuredBy(viewer.country) };
  });
};
