import type { FastifyPluginAsync } from 'fastify';
import type { ProbeNetwork } from '../config.js';

interface StatusOptions {
  network: ProbeNetwork;
  ooniEnabled: boolean;
  persistence: boolean;
}

export const statusRoutes: FastifyPluginAsync<StatusOptions> = async (app, options) => {
  app.get('/status', async () => ({
    ok: true,
    country: options.network.country,
    network: { isp: options.network.isp, asn: options.network.asn, city: options.network.city },
    ooni: options.ooniEnabled,
    persistence: options.persistence,
    time: new Date().toISOString(),
  }));
};
