import type { FastifyPluginAsync } from 'fastify';
import type { ProbeNetwork } from '../config.js';
import type { PeerClient } from '../services/peer-client.js';

interface StatusOptions {
  network: ProbeNetwork;
  peers: PeerClient[];
  ooniEnabled: boolean;
  persistence: boolean;
}

export const statusRoutes: FastifyPluginAsync<StatusOptions> = async (app, options) => {
  app.get('/status', async () => {
    const own = { isp: options.network.isp, asn: options.network.asn, city: options.network.city };
    const peers = await Promise.all(options.peers.map((peer) => peer.status()));
    return {
      ok: true,
      country: options.network.country,
      network: own,
      networks: [{ ...own, online: true }, ...peers],
      ooni: options.ooniEnabled,
      persistence: options.persistence,
      time: new Date().toISOString(),
    };
  });
};
