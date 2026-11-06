import { type JWTVerifyGetKey, jwtVerify, SignJWT } from 'jose';
import { type Grant, grantFor } from './grant';
import { type Job, jobOf } from './job';

export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
const CACHE_TOKEN_AUDIENCE = 'nx-cache';

export interface TokenOptions {
  githubKeys: JWTVerifyGetKey;
  audience: string;
  /** Numeric, because an ID survives a rename and a name can be reused. */
  repositoryId: string;
  key: Uint8Array;
  ttlSeconds: number;
  defaultBranch: string;
}

export interface CacheToken {
  token: string;
  expiresAt: number;
  grant: Grant;
  job: Job;
}

/**
 * Trades a GitHub Actions OIDC token for a cache token carrying its grant. GitHub signs the
 * job's ref and event, which a pull request can't change, even by editing its workflow.
 */
export class Tokens {
  constructor(private readonly options: TokenOptions) {}

  /** The cache token for a GitHub job, or null when its token isn't one of ours. */
  async exchange(githubToken: string, now = Date.now()): Promise<CacheToken | null> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(githubToken, this.options.githubKeys, {
        issuer: GITHUB_ISSUER,
        algorithms: ['RS256'],
        audience: this.options.audience,
        currentDate: new Date(now),
      }));
    } catch {
      return null;
    }
    if (payload.repository_id !== this.options.repositoryId) return null;
    if (typeof payload.ref !== 'string' || typeof payload.event_name !== 'string') return null;
    const job = jobOf(payload);
    if (!job) return null;

    const claims = { ref: payload.ref, event_name: payload.event_name };
    const grant = grantFor(claims, this.options.defaultBranch);
    const issuedAt = Math.floor(now / 1000);
    const expiresAt = issuedAt + this.options.ttlSeconds;
    const token = await new SignJWT({ read: grant.read, write: grant.write, job: { ...job } })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(CACHE_TOKEN_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.options.key);
    return { token, expiresAt, grant, job };
  }

  /** The grant and job a cache token carries, or null when it's invalid or expired. */
  async grantOf(cacheToken: string, now = Date.now()): Promise<{ grant: Grant; job: Job } | null> {
    try {
      const { payload } = await jwtVerify(cacheToken, this.options.key, {
        audience: CACHE_TOKEN_AUDIENCE,
        algorithms: ['HS256'],
        currentDate: new Date(now),
      });
      const { read, write } = payload;
      if (!Array.isArray(read) || !read.every((n) => typeof n === 'string')) return null;
      if (write !== null && typeof write !== 'string') return null;
      const job =
        typeof payload.job === 'object' && payload.job !== null
          ? jobOf(payload.job as Record<string, unknown>)
          : null;
      if (!job) return null;
      return { grant: { read, write }, job };
    } catch {
      return null;
    }
  }
}
