import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import type { ContainerClient } from '@azure/storage-blob';
import { asHeaderValues } from './metadata';
import type { Entry, Store } from './store';

const BLOCK_BYTES = 8 * 1024 * 1024;
const CONCURRENT_BLOCKS = 4;

function status(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode;
}

/** Cache entries as blobs in one container. Blocks commit only once the whole body has arrived. */
export class AzureStore implements Store {
  constructor(private readonly container: ContainerClient) {}

  async get(key: string): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const { readableStreamBody } = await this.container.getBlobClient(key).download();
      if (!readableStreamBody) return null;
      return Readable.toWeb(readableStreamBody as Readable) as ReadableStream<Uint8Array>;
    } catch (error) {
      if (status(error) === 404) return null;
      throw error;
    }
  }

  async putIfAbsent(key: string, { body, job }: Entry): Promise<'stored' | 'exists'> {
    try {
      await this.container
        .getBlockBlobClient(key)
        .uploadStream(
          Readable.fromWeb(body as NodeWebStream<Uint8Array>),
          BLOCK_BYTES,
          CONCURRENT_BLOCKS,
          {
            conditions: { ifNoneMatch: '*' },
            metadata: asHeaderValues(job),
            blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
          }
        );
      return 'stored';
    } catch (error) {
      const code = status(error);
      if (code === 409 || code === 412) return 'exists';
      throw error;
    }
  }
}
