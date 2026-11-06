import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import type { Bucket } from '@google-cloud/storage';
import type { Entry, Store } from './store';

function status(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Number(error.code)
    : undefined;
}

/** Cache entries as objects in one bucket, which only the server's service account can reach. */
export class GcsStore implements Store {
  constructor(private readonly bucket: Bucket) {}

  async get(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const file = this.bucket.file(key);
    const [exists] = await file.exists();
    if (!exists) return null;
    return Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>;
  }

  async putIfAbsent(key: string, { body, job }: Entry): Promise<'stored' | 'exists'> {
    const upload = this.bucket.file(key).createWriteStream({
      resumable: false,
      contentType: 'application/octet-stream',
      // GCS keeps custom metadata under metadata.metadata.
      metadata: { metadata: { ...job } },
      // Generation 0 means "no object yet": GCS refuses the write if one exists.
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    try {
      await pipeline(Readable.fromWeb(body as NodeWebStream<Uint8Array>), upload);
      return 'stored';
    } catch (error) {
      if (status(error) === 412) return 'exists';
      throw error;
    }
  }
}
