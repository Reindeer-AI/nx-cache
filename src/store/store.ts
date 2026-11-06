import type { Job } from '../auth/job';

export interface Entry {
  body: ReadableStream<Uint8Array>;
  /** S3 needs the length before the body; the server requires Content-Length. */
  size: number;
  /** Recorded as the entry's metadata: the run that wrote it. */
  job: Job;
}

/** Where cache entries live. Keys are `<namespace>/<hash>`. */
export interface Store {
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  /** An existing entry is never replaced. A failed upload leaves no entry and rejects. */
  putIfAbsent(key: string, entry: Entry): Promise<'stored' | 'exists'>;
}
