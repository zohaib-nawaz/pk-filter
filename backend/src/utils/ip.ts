import { BlockList, isIP } from 'node:net';

const reserved = new BlockList();

const IPV4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const IPV6_RANGES: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

for (const [network, prefix] of IPV4_RANGES) reserved.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of IPV6_RANGES) reserved.addSubnet(network, prefix, 'ipv6');

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function isPublicIp(address: string): boolean {
  const ip = stripBrackets(address);
  const mapped = MAPPED_V4.exec(ip);
  if (mapped?.[1]) return isPublicIp(mapped[1]);
  const version = isIP(ip);
  if (version === 4) return !reserved.check(ip, 'ipv4');
  if (version === 6) return !ip.toLowerCase().startsWith('::ffff:') && !reserved.check(ip, 'ipv6');
  return false;
}
