import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Job } from '../src/auth/job';
import type { Store } from '../src/store/store';
import { JOB } from './fakes';

export interface Subject {
  store: Store;
  /** The job recorded on the entry, read directly from the backend rather than through the store. */
  writerOf(key: string): Promise<Job>;
  stop?(): Promise<unknown>;
}

const encoder = new TextEncoder();
const body = (text: string) => new Response(text).body as ReadableStream<Uint8Array>;
const entry = (text: string, job = JOB) => ({
  body: body(text),
  size: encoder.encode(text).length,
  job,
});
const read = async (stream: ReadableStream<Uint8Array> | null) =>
  stream ? new Response(stream).text() : null;

/** What every store must do. The server's guarantees rest on these, on every backend. */
export function describeStore(name: string, start: () => Promise<Subject>) {
  describe(name, () => {
    let subject: Subject;
    beforeAll(async () => {
      subject = await start();
    }, 180_000);
    afterAll(() => subject?.stop?.());

    it('stores an entry once, with the run that wrote it, and refuses a second write', async () => {
      const { store, writerOf } = subject;
      expect(await store.putIfAbsent('main/once', entry('first'))).toBe('stored');
      expect(await store.putIfAbsent('main/once', entry('second'))).toBe('exists');
      expect(await read(await store.get('main/once'))).toBe('first');
      expect(await writerOf('main/once')).toEqual(JOB);
    });

    it('answers null for a missing entry', async () => {
      expect(await subject.store.get('main/missing')).toBeNull();
    });

    it('stores an empty entry', async () => {
      const { store } = subject;
      expect(await store.putIfAbsent('main/empty', entry(''))).toBe('stored');
      expect(await read(await store.get('main/empty'))).toBe('');
    });

    it('leaves no entry when the upload fails midway, and rejects', async () => {
      const { store } = subject;
      const failing = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('partial'));
          controller.error(new Error('connection lost'));
        },
      });
      const upload = store.putIfAbsent('main/partial', { body: failing, size: 1024, job: JOB });
      await expect(upload).rejects.toThrow();
      expect(await store.get('main/partial')).toBeNull();
    });

    it('lets exactly one of two simultaneous writes win', async () => {
      const { store } = subject;
      const results = await Promise.all([
        store.putIfAbsent('main/race', entry('one')),
        store.putIfAbsent('main/race', entry('two')),
      ]);
      expect(results.toSorted()).toEqual(['exists', 'stored']);
    });

    it('records a job whose values are not ASCII', async () => {
      const { store, writerOf } = subject;
      const job = {
        ...JOB,
        workflow_ref: 'acme/widgets/.github/workflows/ciü.yml@refs/heads/main',
      };
      expect(await store.putIfAbsent('main/unicode', entry('x', job))).toBe('stored');
      expect(await writerOf('main/unicode')).toEqual(job);
    });
  });
}
