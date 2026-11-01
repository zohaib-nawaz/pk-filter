import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './database/migrate.js';
import { createPool } from './database/pool.js';
import { createPgRepository, nullRepository, type CheckRepository } from './database/repository.js';
import { createAccessibilityService } from './services/accessibility-service.js';
import { createOoniService } from './services/ooni-service.js';
import { createPakistanProbe } from './services/pakistan-probe.js';

const PRUNE_INTERVAL_MS = 6 * 3_600_000;

async function createRepository(): Promise<CheckRepository> {
  if (!config.databaseUrl) return nullRepository;
  const pool = createPool(config.databaseUrl);
  await migrate(pool);
  return createPgRepository(pool);
}

const repository = await createRepository();
const ooni = createOoniService({ baseUrl: config.ooniBaseUrl, country: config.network.country, enabled: config.ooniEnabled });

const app = await buildApp({
  service: createAccessibilityService({
    probe: createPakistanProbe(config.network),
    ooni,
    repository,
    network: config.network,
    concurrency: config.checkConcurrency,
    onError: (error, domain) => app.log.warn({ err: error, domain }, 'check_failed'),
  }),
  network: config.network,
  ooniEnabled: config.ooniEnabled,
  persistence: repository !== nullRepository,
  rateLimitPerMinute: config.rateLimitPerMinute,
  trustProxy: config.trustProxy,
  logger: { level: config.logLevel },
});

const pruneTimer = setInterval(() => {
  repository
    .prune(config.retentionDays)
    .then((removed) => app.log.info({ removed }, 'pruned_old_checks'))
    .catch((error) => app.log.error({ err: error }, 'prune_failed'));
}, PRUNE_INTERVAL_MS);
pruneTimer.unref();

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting_down');
  clearInterval(pruneTimer);
  await app.close();
  await repository.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
