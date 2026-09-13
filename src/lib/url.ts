import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { envFlag } from './env';

/** Normalizes a project base URL: https only, no path/query/hash, no trailing slash. */
export function normalizeBaseUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URL must start with http(s)://');
  if (u.protocol === 'http:' && !envFlag('ALLOW_HTTP_TARGETS')) {
    throw new Error('Only https:// targets are allowed (set ALLOW_HTTP_TARGETS=true to allow http)');
  }
  if (u.username || u.password) throw new Error('URL must not contain credentials');
  if (u.search || u.hash) throw new Error('Base URL must not contain a query string or hash');
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier NAT
    a >= 224 // multicast / reserved
  );
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]!);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true; // not an IP → treat as unsafe
}

/**
 * SSRF guard used when creating a project: the host must resolve to public addresses only.
 * Set ALLOW_PRIVATE_TARGETS=true for local development against localhost targets.
 */
export async function assertPublicHost(baseUrl: string): Promise<void> {
  if (envFlag('ALLOW_PRIVATE_TARGETS')) return;
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('Internal hostnames are not allowed');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Private IP addresses are not allowed');
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve ${host}`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('Hostname resolves to a private address');
  }
}
