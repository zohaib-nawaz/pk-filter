import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './database/migrate.js';
import { createPool } from './database/pool.js';
import { createPgRepository, nullRepository, type CheckRepository } from './database/repository.js';
import { createAccessibilityService } from './services/accessibility-service.js';
import { openGeoIp } from './services/geoip.js';
import { createOoniDirectory } from './services/ooni-service.js';
import { createNetworkProbe } from './services/network-probe.js';
import { createDownloadSlots } from './services/media/slots.js';
import { createPeerClient, type PeerClient } from './services/peer-client.js';
import { countryCode } from './utils/country.js';

if (!countryCode(config.network.country)) {
  console.error('PROBE_COUNTRY must be the two-letter code of the country this server runs in (for example DE or US)');
  process.exit(1);
}

const PRUNE_INTERVAL_MS = 6 * 3_600_000;

async function createRepository(): Promise<CheckRepository> {
  if (!config.databaseUrl) {
    return nullRepository;
  }
  const pool = createPool(config.databaseUrl, (error) => console.error('database_error', error.message));
  await migrate(pool);
  return createPgRepository(pool);
}

const repository = await createRepository();
const ooni = createOoniDirectory({ baseUrl: config.ooniBaseUrl, enabled: config.ooniEnabled });
const geoip = await openGeoIp(config.geoipDb, (error) => console.error('geoip_unavailable', error instanceof Error ? error.message : error));
const localPeers: PeerClient[] = [];
const countryPeers: Record<string, PeerClient[]> = {};
for (const peer of config.peerProbes) {
  const client = createPeerClient(peer.url, config.probeToken);
  if (!peer.country || peer.country === config.network.country) {
    localPeers.push(client);
    continue;
  }
  const group = countryPeers[peer.country];
  if (group) {
    group.push(client);
  } else {
    countryPeers[peer.country] = [client];
  }
}
let logCheckFailure: (error: unknown, domain: string) => void = () => undefined;

const service = createAccessibilityService({
  probe: createNetworkProbe(config.network),
  ooni: ooni.forCountry(config.network.country),
  repository,
  network: config.network,
  concurrency: config.checkConcurrency,
  onError: (error, domain) => logCheckFailure(error, domain),
});

const app = await buildApp({
  service,
  repository,
  peers: localPeers,
  countryPeers,
  ooni,
  geoip,
  probeToken: config.probeToken,
  corsOrigins: config.corsOrigins,
  media: config.media.enabled
    ? {
        secret: config.media.secret,
        maxBytes: config.media.maxBytes,
        ticketTtlMs: config.media.ticketTtlMs,
        metaToken: config.media.metaToken,
        slots: createDownloadSlots(config.media.maxConcurrent, config.media.maxPerClient),
      }
    : undefined,
  network: config.network,
  ooniEnabled: config.ooniEnabled,
  persistence: repository !== nullRepository,
  rateLimitPerMinute: config.rateLimitPerMinute,
  trustProxy: config.trustProxy,
  logger: { level: config.logLevel },
});
logCheckFailure = (error, domain) => app.log.warn({ err: error, domain }, 'check_failed');
if (config.media.enabled && !config.media.secretConfigured) {
  app.log.warn('MEDIA_SECRET is not set (32+ characters); download links stop working after every restart');
}

function prune() {
  repository
    .prune(config.retentionDays)
    .then((removed) => app.log.info({ removed }, 'pruned_old_checks'))
    .catch((error) => app.log.error({ err: error }, 'prune_failed'));
}

const pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);
pruneTimer.unref();
prune();

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
  app.log.info({ signal }, 'shutting_down');
  clearInterval(pruneTimer);
  try {
    await app.close();
    await service.drain();
    await repository.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'shutdown_failed');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
