import Fastify, { type FastifyServerOptions } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { ProbeNetwork } from './config.js';
import { nullRepository, type CheckRepository } from './database/repository.js';
import { accessibilityRoutes } from './routes/accessibility.js';
import { historyRoutes } from './routes/history.js';
import { probeRoutes } from './routes/probe.js';
import { statusRoutes } from './routes/status.js';
import type { AccessibilityService } from './services/accessibility-service.js';
import { createMultiNetworkService } from './services/multi-network-service.js';
import type { PeerClient } from './services/peer-client.js';
import { sameToken } from './utils/token.js';

export interface AppOptions {
  service: AccessibilityService;
  repository?: CheckRepository;
  peers?: PeerClient[];
  probeToken?: string;
  network: ProbeNetwork;
  ooniEnabled: boolean;
  persistence: boolean;
  rateLimitPerMinute: number;
  trustProxy?: boolean;
  logger?: FastifyServerOptions['logger'];
}

function peersOf(options: AppOptions): PeerClient[] {
  if (!options.peers) {
    return [];
  }
  return options.peers;
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.trustProxy ?? false,
    bodyLimit: 16 * 1024,
    connectionTimeout: 90_000,
    requestTimeout: 90_000,
  });

  const probeToken = options.probeToken ?? '';
  await app.register(rateLimit, {
    max: options.rateLimitPerMinute,
    timeWindow: '1 minute',
    allowList: (request) => sameToken(request.headers['x-probe-token'], probeToken),
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.get('/health', async () => ({ ok: true }));
  const peers = peersOf(options);
  const combined = peers.length > 0 ? createMultiNetworkService(options.service, peers, (error) => app.log.warn({ err: error }, 'peer_failed')) : options.service;
  await app.register(accessibilityRoutes, { prefix: '/api/v1', service: combined });
  await app.register(historyRoutes, { prefix: '/api/v1', repository: options.repository ?? nullRepository });
  if (probeToken) {
    await app.register(probeRoutes, { prefix: '/api/v1', service: options.service, token: probeToken });
  }
  await app.register(statusRoutes, {
    prefix: '/api/v1',
    network: options.network,
    peers,
    ooniEnabled: options.ooniEnabled,
    persistence: options.persistence,
  });

  return app;
}
