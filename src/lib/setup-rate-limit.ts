const WINDOW_MS = 60_000;
const PER_CLIENT_LIMIT = 10;
const GLOBAL_LIMIT = 30;
const MAX_CLIENTS = 512;

type Bucket = { count: number; resetAt: number };

const clients = new Map<string, Bucket>();
const globalBucket: Bucket = { count: 0, resetAt: 0 };

function consume(bucket: Bucket, limit: number, now: number): { allowed: boolean; retryAfter: number } {
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim()
    ?? 'unknown';
}

/** Bounded process-local protection for public setup mutations and bcrypt token checks. */
export function checkSetupRateLimit(request: Request): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const globalResult = consume(globalBucket, GLOBAL_LIMIT, now);
  const key = clientKey(request).slice(0, 128);
  let bucket = clients.get(key);
  if (!bucket) {
    if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value as string);
    bucket = { count: 0, resetAt: 0 };
    clients.set(key, bucket);
  }
  const clientResult = consume(bucket, PER_CLIENT_LIMIT, now);
  return {
    allowed: globalResult.allowed && clientResult.allowed,
    retryAfter: Math.max(globalResult.retryAfter, clientResult.retryAfter),
  };
}
