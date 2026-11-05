import { TtlCache } from '../utils/ttl-cache.js';
import type { AccessibilityService, CheckResult } from './accessibility-service.js';
import { createMultiNetworkService } from './multi-network-service.js';
import type { OoniDirectory } from './ooni-service.js';
import { createOoniOnlyService } from './ooni-only-service.js';
import type { PeerClient } from './peer-client.js';

export type MeasuredBy = 'probe' | 'peer' | 'ooni';

export interface CountryRouter {
  forCountry(country: string): AccessibilityService;
  measuredBy(country: string): MeasuredBy;
  probeCountries(): string[];
  drain(): Promise<void>;
}

interface RouterOptions {
  localCountry: string;
  local: AccessibilityService;
  countryPeers: Record<string, PeerClient[]>;
  ooni: OoniDirectory;
  onError?: (error: unknown) => void;
}

const MAX_SERVICES = 64;
const PEER_CACHE_SIZE = 20_000;

function peerService(peer: PeerClient): AccessibilityService {
  const cache = new TtlCache<string, CheckResult>(PEER_CACHE_SIZE);
  return {
    async check(domains) {
      const missing = domains.filter((domain) => cache.get(domain) === undefined);
      if (missing.length > 0) {
        for (const result of await peer.check(missing)) {
          cache.set(result.domain, result, result.ttlSeconds * 1000);
        }
      }
      return domains.map((domain) => cache.get(domain)).filter((result): result is CheckResult => result !== undefined);
    },
    drain: async () => undefined,
  };
}

function withFallback(primary: AccessibilityService, fallback: AccessibilityService, onError?: (error: unknown) => void): AccessibilityService {
  return {
    async check(domains) {
      try {
        const results = await primary.check(domains);
        const answered = new Set(results.map((result) => result.domain));
        const missing = domains.filter((domain) => !answered.has(domain));
        if (missing.length === 0) {
          return results;
        }
        return [...results, ...(await fallback.check(missing))];
      } catch (error) {
        onError?.(error);
        return fallback.check(domains);
      }
    },
    drain: () => fallback.drain(),
  };
}

export function createCountryRouter(options: RouterOptions): CountryRouter {
  const services = new Map<string, AccessibilityService>();

  function build(country: string): AccessibilityService {
    const ooniOnly = createOoniOnlyService(country, options.ooni.forCountry(country), options.onError);
    const peers = options.countryPeers[country];
    if (!peers || peers.length === 0) {
      return ooniOnly;
    }
    const [first, ...rest] = peers as [PeerClient, ...PeerClient[]];
    return withFallback(createMultiNetworkService(peerService(first), rest, options.onError), ooniOnly, options.onError);
  }

  function forCountry(country: string): AccessibilityService {
    if (country === options.localCountry) {
      return options.local;
    }
    const existing = services.get(country);
    if (existing) {
      return existing;
    }
    const created = build(country);
    services.set(country, created);
    if (services.size > MAX_SERVICES) {
      const oldest = services.keys().next();
      if (!oldest.done) {
        services.delete(oldest.value);
      }
    }
    return created;
  }

  function measuredBy(country: string): MeasuredBy {
    if (country === options.localCountry) {
      return 'probe';
    }
    const peers = options.countryPeers[country];
    if (peers && peers.length > 0) {
      return 'peer';
    }
    return 'ooni';
  }

  return {
    forCountry,
    measuredBy,
    probeCountries: () => [options.localCountry, ...Object.keys(options.countryPeers).filter((country) => country !== options.localCountry)],
    drain: async () => {
      await Promise.allSettled([options.local.drain(), ...[...services.values()].map((service) => service.drain())]);
    },
  };
}
