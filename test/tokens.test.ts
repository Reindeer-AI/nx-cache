import { describe, expect, it } from 'bun:test';
import { fakeGitHub, fakeTokens, JOB } from './fakes';

const MAIN_PUSH = { ref: 'refs/heads/main', event_name: 'push' };
const PULL_REQUEST = { ref: 'refs/pull/12/merge', event_name: 'pull_request' };

describe('Tokens', () => {
  it('trades a job token for a cache token that carries its grant and job', async () => {
    const { tokens, jobToken } = await fakeTokens();
    const cache = await tokens.exchange(await jobToken(PULL_REQUEST));
    expect(cache?.grant).toEqual({ read: ['pr-12', 'main'], write: 'pr-12' });
    expect(cache?.job).toEqual(JOB);
    expect(await tokens.grantOf(cache?.token ?? '')).toEqual({
      grant: { read: ['pr-12', 'main'], write: 'pr-12' },
      job: JOB,
    });
  });

  it('refuses a job token without the job claims', async () => {
    const { tokens, jobToken } = await fakeTokens();
    expect(
      await tokens.exchange(await jobToken({ ...PULL_REQUEST, run_id: undefined }))
    ).toBeNull();
  });

  it('refuses a job token from another repository', async () => {
    const { tokens, jobToken } = await fakeTokens();
    expect(await tokens.exchange(await jobToken({ ...MAIN_PUSH, repository_id: '1' }))).toBeNull();
  });

  it('refuses a job token GitHub did not sign', async () => {
    const { tokens } = await fakeTokens();
    const forger = await fakeGitHub();
    expect(await tokens.exchange(await forger.jobToken(MAIN_PUSH))).toBeNull();
  });

  it('refuses a job token for another audience or issuer, or expired', async () => {
    const { tokens, jobToken } = await fakeTokens();
    expect(
      await tokens.exchange(await jobToken(MAIN_PUSH, { audience: 'sts.amazonaws.com' }))
    ).toBeNull();
    expect(
      await tokens.exchange(await jobToken(MAIN_PUSH, { issuer: 'https://example.com' }))
    ).toBeNull();
    expect(await tokens.exchange(await jobToken(MAIN_PUSH, { expiresIn: '-1m' }))).toBeNull();
  });

  it('refuses a cache token that expired, or that another server signed', async () => {
    const { tokens, jobToken } = await fakeTokens();
    const now = Date.now();
    const cache = await tokens.exchange(await jobToken(MAIN_PUSH), now);
    expect(await tokens.grantOf(cache?.token ?? '', now + 3601 * 1000)).toBeNull();

    const other = await fakeTokens();
    expect(await other.tokens.grantOf(cache?.token ?? '')).toBeNull();
  });

  it('never accepts a GitHub job token as a cache token', async () => {
    const { tokens, jobToken } = await fakeTokens();
    expect(await tokens.grantOf(await jobToken(MAIN_PUSH))).toBeNull();
  });
});
