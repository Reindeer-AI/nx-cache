import type { Grant } from './auth/grant';
import type { Job } from './auth/job';
import type { Tokens } from './auth/tokens';
import type { Log } from './log';
import type { Store } from './store/store';

/** Letters and digits only (Nx's hashes are digits); anything else could escape the namespace. */
const HASH = /^[0-9a-zA-Z]{1,128}$/;
const CACHE_PATH = /^\/v1\/cache\/([^/]+)$/;

/** A message for the Nx CLI user; the spec declares text/plain. */
function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain' } });
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header ? /^Bearer (\S+)$/i.exec(header) : null;
  return match?.[1] ?? null;
}

/**
 * Nx's self-hosted cache API (GET and PUT /v1/cache/{hash}), plus POST /v1/token, which trades a
 * GitHub Actions OIDC token for the cache token Nx sends.
 */
export function createApp(options: { tokens: Tokens; store: Store; log: Log }) {
  const { tokens, store, log } = options;

  async function grantOf(request: Request): Promise<{ grant: Grant; job: Job } | null> {
    const token = bearer(request);
    return token ? tokens.grantOf(token) : null;
  }

  async function exchange(request: Request): Promise<Response> {
    const token = bearer(request);
    const cache = token ? await tokens.exchange(token) : null;
    if (!cache) return text('Invalid GitHub token', 401);
    log('info', 'token issued', { read: cache.grant.read, write: cache.grant.write, ...cache.job });
    return Response.json({
      token: cache.token,
      expiresAt: cache.expiresAt,
      read: cache.grant.read,
      write: cache.grant.write,
    });
  }

  async function read(grant: Grant, hash: string): Promise<Response> {
    for (const namespace of grant.read) {
      const body = await store.get(`${namespace}/${hash}`);
      if (body) {
        return new Response(body, { headers: { 'content-type': 'application/octet-stream' } });
      }
    }
    return text('Not found', 404);
  }

  async function write(
    grant: Grant,
    job: Job,
    hash: string,
    size: number,
    request: Request
  ): Promise<Response> {
    if (!grant.write) return text('This token can only read', 403);
    // A Content-Length: 0 request has no body stream; it stores an empty entry like any other.
    const body = request.body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() });
    const result = await store.putIfAbsent(`${grant.write}/${hash}`, { body, size, job });
    if (result === 'exists') return text('Already cached', 409);
    log('info', 'stored', { namespace: grant.write, hash, ...job });
    return new Response(null, { status: 200 });
  }

  // Statuses follow the vendored spec, except 411: a PUT without Content-Length is outside it.
  async function get(request: Request, hash: string): Promise<Response> {
    if (!HASH.test(hash)) return text('Not found', 404);
    const access = await grantOf(request);
    if (!access) return text('Invalid cache token', 403);
    return read(access.grant, hash);
  }

  async function put(request: Request, hash: string): Promise<Response> {
    const size = Number(request.headers.get('content-length') ?? Number.NaN);
    if (!Number.isSafeInteger(size) || size < 0) return text('Content-Length is required', 411);
    if (!HASH.test(hash)) return text('Invalid hash', 403);
    const access = await grantOf(request);
    if (!access) return text('Invalid cache token', 401);
    return write(access.grant, access.job, hash, size, request);
  }

  function cache(request: Request, hash: string): Promise<Response> | Response {
    if (request.method === 'GET') return get(request, hash);
    if (request.method === 'PUT') return put(request, hash);
    return text('Method not allowed', 405);
  }

  return async function fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/healthz') return new Response('ok');
    if (request.method === 'POST' && pathname === '/v1/token') return exchange(request);
    const hash = CACHE_PATH.exec(pathname)?.[1];
    return hash === undefined ? text('Not found', 404) : cache(request, hash);
  };
}
