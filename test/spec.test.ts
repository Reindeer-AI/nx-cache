import { describe, expect, it } from 'bun:test';
import spec from '../contract/nx-self-hosted-cache.openapi.json';
import { fakeCache, HASH } from './fakes';

type Responses = Record<string, { content?: Record<string, unknown> }>;
const operations = spec.paths['/v1/cache/{hash}'] as unknown as Record<
  'get' | 'put',
  { responses: Responses }
>;

const MAIN_PUSH = { ref: 'refs/heads/main', event_name: 'push' };
const BRANCH_PUSH = { ref: 'refs/heads/feature', event_name: 'push' };
const BAD_HASH = 'a.b';

function expectListed(method: 'get' | 'put', response: Response) {
  const listed = operations[method].responses[String(response.status)];
  expect(listed, `${method.toUpperCase()} answered ${response.status}`).toBeDefined();
  const types = Object.keys(listed?.content ?? {});
  if (types.length > 0) {
    expect(types).toContain(response.headers.get('content-type')?.split(';')[0]?.trim() ?? '');
  }
}

describe("Nx's self-hosted cache spec", () => {
  it('GET answers only with the statuses the spec lists', async () => {
    const { cacheToken, get, put } = await fakeCache();
    const main = await cacheToken(MAIN_PUSH);
    await put(main, 'entry');

    const responses = {
      hit: await get(main),
      miss: await get(main, '42'),
      badToken: await get('nope'),
      readOnly: await get(await cacheToken(BRANCH_PUSH)),
      badHash: await get(main, BAD_HASH),
    };
    expect(Object.values(responses).map((r) => r.status)).toEqual([200, 404, 403, 200, 404]);
    for (const response of Object.values(responses)) expectListed('get', response);
  });

  it('PUT answers only with the statuses the spec lists', async () => {
    const { cacheToken, put } = await fakeCache();
    const main = await cacheToken(MAIN_PUSH);

    const responses = {
      stored: await put(main, 'entry'),
      existing: await put(main, 'again'),
      badToken: await put('nope', 'entry', '42'),
      readOnly: await put(await cacheToken(BRANCH_PUSH), 'entry', '43'),
      badHash: await put(main, 'entry', BAD_HASH),
    };
    expect(Object.values(responses).map((r) => r.status)).toEqual([200, 409, 401, 403, 403]);
    for (const response of Object.values(responses)) expectListed('put', response);
  });

  it('refuses a PUT whose Content-Length is not a size', async () => {
    const { app, store, cacheToken } = await fakeCache();
    const response = await app(
      new Request(`http://cache/v1/cache/${HASH}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${await cacheToken(MAIN_PUSH)}`, 'content-length': 'x' },
        body: 'entry',
      })
    );
    expect(response.status).toBe(411);
    expect(store.entries.size).toBe(0);
  });

  it('refuses a PUT without the Content-Length the spec requires, before reading it', async () => {
    const { app, store, cacheToken } = await fakeCache();
    const main = await cacheToken(MAIN_PUSH);
    // A streamed body: the request carries no Content-Length.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('entry'));
        controller.close();
      },
    });
    const response = await app(
      new Request(`http://cache/v1/cache/${HASH}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${main}` },
        body,
      })
    );
    expect(response.status).toBe(411);
    expect(store.entries.size).toBe(0);
  });
});
