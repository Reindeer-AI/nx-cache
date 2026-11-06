import { describe, expect, it } from 'bun:test';
import { fakeCache, HASH, JOB } from './fakes';

const MAIN_PUSH = { ref: 'refs/heads/main', event_name: 'push' };
const pullRequest = (n: number) => ({ ref: `refs/pull/${n}/merge`, event_name: 'pull_request' });
describe('nx-cache', () => {
  it('serves what main stored to main and to pull requests', async () => {
    const { cacheToken, get, put } = await fakeCache();
    const main = await cacheToken(MAIN_PUSH);
    expect((await put(main, 'from main')).status).toBe(200);

    expect(await (await get(main)).text()).toBe('from main');
    expect(await (await get(await cacheToken(pullRequest(1)))).text()).toBe('from main');
  });

  it('keeps a pull request’s entries to that pull request', async () => {
    const { store, cacheToken, get, put } = await fakeCache();
    const pr = await cacheToken(pullRequest(1));
    expect((await put(pr, 'poisoned')).status).toBe(200);
    expect([...store.entries.keys()]).toEqual([`pr-1/${HASH}`]);
    // The entry records the run that wrote it.
    expect(store.writers.get(`pr-1/${HASH}`)).toEqual(JOB);

    expect(await (await get(pr)).text()).toBe('poisoned');
    expect((await get(await cacheToken(MAIN_PUSH))).status).toBe(404);
    expect((await get(await cacheToken(pullRequest(2)))).status).toBe(404);
  });

  it('reads a pull request’s own entry before main’s', async () => {
    const { cacheToken, get, put } = await fakeCache();
    await put(await cacheToken(MAIN_PUSH), 'from main');
    const pr = await cacheToken(pullRequest(1));
    await put(pr, 'from the pull request');
    expect(await (await get(pr)).text()).toBe('from the pull request');
  });

  it('never replaces an entry', async () => {
    const { cacheToken, get, put } = await fakeCache();
    const main = await cacheToken(MAIN_PUSH);
    await put(main, 'first');
    expect((await put(main, 'second')).status).toBe(409);
    expect(await (await get(main)).text()).toBe('first');
  });

  it('lets a read-only token read but not write', async () => {
    const { cacheToken, get, put } = await fakeCache();
    await put(await cacheToken(MAIN_PUSH), 'from main');
    const branch = await cacheToken({ ref: 'refs/heads/feature', event_name: 'push' });
    expect(await (await get(branch)).text()).toBe('from main');
    expect((await put(branch, 'x', '42')).status).toBe(403);
  });

  it('turns away requests without a valid token', async () => {
    const { app, get, put, jobToken } = await fakeCache();
    // Nx's spec lists 403, not 401, for a GET.
    expect((await get('nope')).status).toBe(403);
    expect((await put('nope', 'x')).status).toBe(401);
    // A GitHub token is only good for the exchange, not as a cache token.
    expect((await get(await jobToken(MAIN_PUSH))).status).toBe(403);
    expect((await app(new Request(`http://cache/v1/cache/${HASH}`))).status).toBe(403);

    const exchange = await app(
      new Request('http://cache/v1/token', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await jobToken({ ...MAIN_PUSH, repository_id: '1' })}`,
        },
      })
    );
    expect(exchange.status).toBe(401);
  });

  it('never takes a hash that could leave the namespace to the store', async () => {
    const { store, cacheToken, get, put } = await fakeCache();
    const main = await cacheToken(MAIN_PUSH);
    for (const hash of ['..%2Fpr-1%2F1', 'a.b']) {
      expect((await get(main, hash)).status).toBe(404);
      expect((await put(main, 'x', hash)).status).toBe(403);
    }
    expect(store.reads).toEqual([]);
    expect(store.entries.size).toBe(0);
  });

  it('stores an empty entry', async () => {
    const { cacheToken, get, put } = await fakeCache();
    const main = await cacheToken(MAIN_PUSH);
    expect((await put(main, '')).status).toBe(200);
    const response = await get(main);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
});
