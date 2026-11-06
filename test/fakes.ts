import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../src/app';
import { GITHUB_ISSUER, Tokens } from '../src/auth/tokens';
import { MemoryStore } from './memory-store';

const AUDIENCE = 'https://nx-cache.test';
const REPOSITORY_ID = '123456789';

/** The job claims GitHub puts in every token, as a pull request's job would carry them. */
export const JOB = {
  sub: 'repo:acme/widgets:pull_request',
  run_id: '19000000001',
  sha: '0123456789abcdef0123456789abcdef01234567',
  workflow_ref: 'acme/widgets/.github/workflows/ci.yml@refs/pull/12/merge',
};

/** Stands in for GitHub's OIDC provider: signs job tokens with a key only the test knows. */
export async function fakeGitHub() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  const keys = createLocalJWKSet({ keys: [jwk] });

  async function jobToken(
    claims: Record<string, unknown>,
    options: { issuer?: string; audience?: string; expiresIn?: string } = {}
  ): Promise<string> {
    return new SignJWT({ repository_id: REPOSITORY_ID, ...JOB, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(options.issuer ?? GITHUB_ISSUER)
      .setAudience(options.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '5m')
      .sign(privateKey);
  }

  return { keys, jobToken };
}

export async function fakeTokens(): Promise<{
  tokens: Tokens;
  jobToken: Awaited<ReturnType<typeof fakeGitHub>>['jobToken'];
}> {
  const github = await fakeGitHub();
  const tokens = new Tokens({
    githubKeys: github.keys,
    audience: AUDIENCE,
    repositoryId: REPOSITORY_ID,
    key: crypto.getRandomValues(new Uint8Array(32)),
    ttlSeconds: 3600,
    defaultBranch: 'main',
  });
  return { tokens, jobToken: github.jobToken };
}

export const HASH = '1234567890';

/** The app over a MemoryStore, with helpers that call it as Nx and CI would. */
export async function fakeCache() {
  const { tokens, jobToken } = await fakeTokens();
  const store = new MemoryStore();
  const app = createApp({ tokens, store, log: () => {} });

  async function cacheToken(claims: Record<string, unknown>): Promise<string> {
    const response = await app(
      new Request('http://cache/v1/token', {
        method: 'POST',
        headers: { authorization: `Bearer ${await jobToken(claims)}` },
      })
    );
    return ((await response.json()) as { token: string }).token;
  }

  const get = (token: string, hash = HASH) =>
    app(
      new Request(`http://cache/v1/cache/${hash}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    );
  const put = (token: string, body: string, hash = HASH) =>
    app(
      new Request(`http://cache/v1/cache/${hash}`, {
        method: 'PUT',
        // An HTTP client sends it; a Request built in-process doesn't add it.
        headers: {
          authorization: `Bearer ${token}`,
          'content-length': String(new TextEncoder().encode(body).length),
        },
        body,
      })
    );

  return { app, store, cacheToken, get, put, jobToken };
}
