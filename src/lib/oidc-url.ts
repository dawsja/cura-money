import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { env, resolveOrigin } from './env';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DISCOVERY_TIMEOUT_MS = 5_000;
const MAX_DISCOVERY_BYTES = 1024 * 1024;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

function parseSecureUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}_invalid_url`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label}_https_required`);
  if (url.username || url.password) throw new Error(`${label}_credentials_forbidden`);
  return url;
}

export function assertSecureOidcUrl(value: string, label: string): void {
  parseSecureUrl(value, label);
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, 'ipv4');
  if (family === 6) {
    // Currently allocated global-unicast IPv6 space is 2000::/3.
    if (!/^[23]/i.test(address)) return true;
    return blockedAddresses.check(address, 'ipv6');
  }
  return true;
}

/** Resolve and reject every non-public address, rather than trusting only the hostname text. */
export async function assertPublicOidcUrl(value: string, label: string): Promise<URL> {
  const url = parseSecureUrl(value, label);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error(`${label}_private_address`);
  }

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (isBlockedAddress(hostname)) throw new Error(`${label}_private_address`);
    return url;
  }

  let addresses: Array<{ address: string }>;
  let dnsTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        dnsTimeout = setTimeout(() => reject(new Error('dns_timeout')), DISCOVERY_TIMEOUT_MS);
      }),
    ]);
  } catch {
    throw new Error(`${label}_dns_unresolved`);
  } finally {
    clearTimeout(dnsTimeout);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error(`${label}_private_address`);
  }
  return url;
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DISCOVERY_BYTES) {
    throw new Error('discovery_doc_too_large');
  }
  if (!response.body) throw new Error('discovery_doc_invalid_json');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DISCOVERY_BYTES) throw new Error('discovery_doc_too_large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('discovery_doc_invalid_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('discovery_doc_invalid_json');
  }
  return parsed as Record<string, unknown>;
}

/** Fetch a discovery document without redirects and validate every advertised OIDC target. */
export async function fetchSecureOidcDiscovery(value: string): Promise<Record<string, unknown>> {
  const url = await assertPublicOidcUrl(value.trim(), 'discovery_url');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) throw new Error('discovery_doc_redirect_forbidden');
    if (!response.ok) throw new Error(`discovery_doc_unreachable_${response.status}`);
    const doc = await readBoundedJson(response);

    const endpointNames = [
      'authorization_endpoint',
      'token_endpoint',
      'userinfo_endpoint',
      'jwks_uri',
    ] as const;
    await Promise.all(endpointNames.map(async (name) => {
      const endpoint = doc[name];
      if (endpoint === undefined && (name === 'authorization_endpoint' || name === 'token_endpoint')) {
        throw new Error('discovery_doc_missing_endpoints');
      }
      if (endpoint !== undefined) {
        if (typeof endpoint !== 'string' || endpoint.length === 0) {
          throw new Error(`discovery_doc_invalid_${name}`);
        }
        await assertPublicOidcUrl(endpoint, name);
      }
    }));
    return doc;
  } catch (err) {
    if (controller.signal.aborted) throw new Error('discovery_doc_timeout');
    if (err instanceof Error && err.message.startsWith('discovery_')) throw err;
    if (err instanceof Error && /^(authorization_endpoint|token_endpoint|userinfo_endpoint|jwks_uri)_/.test(err.message)) {
      throw err;
    }
    throw new Error(`discovery_doc_unreachable_${err instanceof Error ? err.message : 'network_error'}`);
  } finally {
    clearTimeout(timeout);
  }
}

function assertSecureCallbackUrl(value: string, label: string): void {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return;
    if (env.NODE_ENV !== 'production' && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return;
  } catch {
    throw new Error(`${label}_invalid_url`);
  }
  throw new Error(`${label}_https_required`);
}

export function assertSecureOidcConfiguration(request: Request): void {
  const configured = [env.APP_URL, env.BETTER_AUTH_URL, env.OIDC_REDIRECT_BASE].filter(Boolean);
  for (const value of configured) assertSecureCallbackUrl(value, 'oidc_base_url');
  assertSecureCallbackUrl(resolveOrigin(request, 'app'), 'oidc_callback_url');
}
