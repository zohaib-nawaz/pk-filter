import Fastify, { type FastifyServerOptions } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { ProbeNetwork } from './config.js';
import { accessibilityRoutes } from './routes/accessibility.js';
import { statusRoutes } from './routes/status.js';
import type { AccessibilityService } from './services/accessibility-service.js';

export interface AppOptions {
  service: AccessibilityService;
  network: ProbeNetwork;
  ooniEnabled: boolean;
  persistence: boolean;
  rateLimitPerMinute: number;
  trustProxy?: boolean;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.trustProxy ?? false,
    bodyLimit: 16 * 1024,
    connectionTimeout: 60_000,
    requestTimeout: 90_000,
  });

  await app.register(rateLimit, { max: options.rateLimitPerMinute, timeWindow: '1 minute' });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(accessibilityRoutes, { prefix: '/api/v1', service: options.service });
  await app.register(statusRoutes, {
    prefix: '/api/v1',
    network: options.network,
    ooniEnabled: options.ooniEnabled,
    persistence: options.persistence,
  });

  return app;
}
