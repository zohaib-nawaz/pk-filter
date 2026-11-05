import type { FastifyPluginAsync } from 'fastify';
import type { ProbeNetwork } from '../config.js';
import type { PeerClient } from '../services/peer-client.js';
import type { CountryResolver } from '../services/viewer-country.js';

interface StatusOptions {
  network: ProbeNetwork;
  peers: PeerClient[];
  probeCountries: string[];
  resolveCountry: CountryResolver;
  ooniEnabled: boolean;
  persistence: boolean;
}

export const statusRoutes: FastifyPluginAsync<StatusOptions> = async (app, options) => {
  app.get('/status', async (request) => {
    const own = { isp: options.network.isp, asn: options.network.asn, city: options.network.city };
    const peers = await Promise.all(options.peers.map((peer) => peer.status()));
    return {
      ok: true,
      country: options.network.country,
      network: own,
      networks: [{ ...own, online: true }, ...peers],
      probeCountries: options.probeCountries,
      viewer: options.resolveCountry({ requested: undefined, ip: request.ip, headerCountry: request.headers['cf-ipcountry'] }),
      ooni: options.ooniEnabled,
      persistence: options.persistence,
      time: new Date().toISOString(),
    };
  });
};
