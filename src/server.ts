import { createRemoteJWKSet } from 'jose';
import { createApp } from './app';
import { GITHUB_ISSUER, Tokens } from './auth/tokens';
import { env } from './config/env';
import { log } from './log';
import { createStore } from './store';

const CACHE_TOKEN_TTL_SECONDS = 60 * 60;
/** Larger than any task's outputs; Bun's default of 128 MiB is not. */
const MAX_ENTRY_BYTES = 2 * 1024 ** 3;
/**
 * Load balancers keep idle connections to the server open for minutes (Google's for 600s). Closing
 * one first, as Bun does after 10s by default, races the next request on it, which then fails.
 */
const NO_IDLE_TIMEOUT = 0;

const tokens = new Tokens({
  githubKeys: createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`)),
  audience: env.OIDC_AUDIENCE,
  repositoryId: env.GITHUB_REPOSITORY_ID,
  key: env.TOKEN_KEY,
  ttlSeconds: CACHE_TOKEN_TTL_SECONDS,
  defaultBranch: env.GITHUB_DEFAULT_BRANCH,
});
const store = createStore(env.STORE, env.BUCKET, { s3Endpoint: env.AWS_ENDPOINT_URL_S3 });

const server = Bun.serve({
  port: env.PORT,
  maxRequestBodySize: MAX_ENTRY_BYTES,
  idleTimeout: NO_IDLE_TIMEOUT,
  fetch: createApp({ tokens, store, log }),
  error(error) {
    log('error', 'request failed', { error: String(error) });
    return new Response('Internal error', { status: 500 });
  },
});

log('info', 'listening', { port: env.PORT, store: env.STORE, bucket: env.BUCKET });

// Lets in-flight uploads and downloads finish instead of cutting them off.
process.on('SIGTERM', async () => {
  log('info', 'draining');
  await server.stop();
  process.exit(0);
});
