import type { Job } from '../src/auth/job';
import type { Entry, Store } from '../src/store/store';

/** Entries in memory, recording what the server asked for. */
export class MemoryStore implements Store {
  readonly entries = new Map<string, string>();
  readonly writers = new Map<string, Job>();
  readonly reads: string[] = [];

  async get(key: string) {
    this.reads.push(key);
    const value = this.entries.get(key);
    return value === undefined ? null : new Response(value).body;
  }

  async putIfAbsent(key: string, { body, job }: Entry) {
    const value = await new Response(body).text();
    if (this.entries.has(key)) return 'exists' as const;
    this.entries.set(key, value);
    this.writers.set(key, job);
    return 'stored' as const;
  }
}
