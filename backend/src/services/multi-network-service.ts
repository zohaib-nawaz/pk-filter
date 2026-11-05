import { TtlCache } from '../utils/ttl-cache.js';
import type { AccessibilityService, CheckResult } from './accessibility-service.js';
import { aggregateNetworks, type NetworkResult } from './network-aggregate.js';
import type { PeerClient } from './peer-client.js';

interface PeerState {
  peer: PeerClient;
  cache: TtlCache<string, CheckResult>;
  failures: number;
  openUntil: number;
}

const PEER_CACHE_SIZE = 20_000;
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 60_000;

function toNetwork(result: CheckResult): NetworkResult {
  return {
    isp: result.network.isp,
    asn: result.network.asn,
    city: result.network.city,
    status: result.status,
    confidence: result.confidence,
    lastChecked: result.lastChecked,
    evidence: result.evidence,
  };
}

export function createMultiNetworkService(
  local: AccessibilityService,
  peers: PeerClient[],
  onError?: (error: unknown) => void,
  now: () => number = Date.now,
): AccessibilityService {
  const states: PeerState[] = peers.map((peer) => ({ peer, cache: new TtlCache(PEER_CACHE_SIZE, now), failures: 0, openUntil: 0 }));

  async function askPeer(state: PeerState, domains: string[]): Promise<CheckResult[]> {
    const missing = domains.filter((domain) => state.cache.get(domain) === undefined);
    if (missing.length > 0 && now() >= state.openUntil) {
      try {
        const fresh = await state.peer.check(missing);
        state.failures = 0;
        for (const result of fresh) {
          state.cache.set(result.domain, result, result.ttlSeconds * 1000);
        }
      } catch (error) {
        state.failures += 1;
        if (state.failures >= BREAKER_THRESHOLD) {
          state.openUntil = now() + BREAKER_OPEN_MS;
          state.failures = 0;
        }
        onError?.(error);
      }
    }
    return domains.map((domain) => state.cache.get(domain)).filter((result): result is CheckResult => result !== undefined);
  }

  async function check(domains: string[]): Promise<CheckResult[]> {
    const [own, ...others] = await Promise.all([local.check(domains), ...states.map((state) => askPeer(state, domains))]);
    return own.map((result) => {
      const peerResults = others.flatMap((list) => list.filter((item) => item.domain === result.domain));
      const networks = [result, ...peerResults].map(toNetwork);
      const ttlSeconds = Math.min(result.ttlSeconds, ...peerResults.map((item) => item.ttlSeconds));
      return { ...result, ...aggregateNetworks(networks), networks, ttlSeconds };
    });
  }

  return { check, drain: () => local.drain() };
}
