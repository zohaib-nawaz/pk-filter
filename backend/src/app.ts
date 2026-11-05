import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { ProbeNetwork } from './config.js';
import { nullRepository, type CheckRepository } from './database/repository.js';
import { accessibilityRoutes } from './routes/accessibility.js';
import { historyRoutes } from './routes/history.js';
import { mediaRoutes, type MediaRouteOptions } from './routes/media.js';
import { probeRoutes } from './routes/probe.js';
import { statusRoutes } from './routes/status.js';
import type { AccessibilityService } from './services/accessibility-service.js';
import { createCountryRouter } from './services/country-router.js';
import { noGeoIp, type GeoIp } from './services/geoip.js';
import { createMultiNetworkService } from './services/multi-network-service.js';
import type { OoniDirectory } from './services/ooni-service.js';
import type { PeerClient } from './services/peer-client.js';
import { createCountryResolver } from './services/viewer-country.js';
import { sameToken } from './utils/token.js';

export interface AppOptions {
  service: AccessibilityService;
  repository?: CheckRepository;
  peers?: PeerClient[];
  countryPeers?: Record<string, PeerClient[]>;
  ooni?: OoniDirectory;
  geoip?: GeoIp;
  corsOrigins?: string[];
  media?: MediaRouteOptions;
  probeToken?: string;
  network: ProbeNetwork;
  ooniEnabled: boolean;
  persistence: boolean;
  rateLimitPerMinute: number;
  trustProxy?: boolean;
  logger?: FastifyServerOptions['logger'];
}

const NO_OONI: OoniDirectory = { forCountry: () => ({ summary: async () => null }) };

function countryPeersOf(options: AppOptions): Record<string, PeerClient[]> {
  if (!options.countryPeers) {
    return {};
  }
  return options.countryPeers;
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

  if (options.corsOrigins && options.corsOrigins.length > 0) {
    await app.register(cors, { origin: options.corsOrigins, methods: ['GET', 'POST'], maxAge: 600 });
  }

  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.get('/health', async () => ({ ok: true }));
  const peers = peersOf(options);
  const onPeerError = (error: unknown) => app.log.warn({ err: error }, 'peer_failed');
  const combined = peers.length > 0 ? createMultiNetworkService(options.service, peers, onPeerError) : options.service;
  const router = createCountryRouter({
    localCountry: options.network.country,
    local: combined,
    countryPeers: countryPeersOf(options),
    ooni: options.ooni ?? NO_OONI,
    onError: onPeerError,
  });
  const resolveCountry = createCountryResolver({
    geoip: options.geoip ?? noGeoIp,
    fallback: options.network.country,
    trustCountryHeader: options.trustProxy ?? false,
  });
  await app.register(accessibilityRoutes, { prefix: '/api/v1', router, resolveCountry });
  await app.register(historyRoutes, { prefix: '/api/v1', repository: options.repository ?? nullRepository, country: options.network.country });
  if (options.media) {
    await app.register(mediaRoutes, { prefix: '/api/v1', ...options.media });
  }
  if (probeToken) {
    await app.register(probeRoutes, { prefix: '/api/v1', service: options.service, token: probeToken });
  }
  await app.register(statusRoutes, {
    prefix: '/api/v1',
    network: options.network,
    peers,
    probeCountries: router.probeCountries(),
    resolveCountry,
    ooniEnabled: options.ooniEnabled,
    persistence: options.persistence,
  });

  app.addHook('onClose', async () => {
    await router.drain();
  });

  return app;
}
