import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { asHeaderValues } from './metadata';
import type { Entry, Store } from './store';

function status(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

/** Cache entries as objects in one bucket. Also serves S3-compatible services. */
export class S3Store implements Store {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    config: S3ClientConfig = {}
  ) {
    // The default also checksums uploads: on S3 under Bun, a streamed PUT then stalls and leaks errors.
    this.client = new S3Client({ ...config, requestChecksumCalculation: 'WHEN_REQUIRED' });
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const { Body } = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return Body?.transformToWebStream() ?? null;
    } catch (error) {
      if (status(error) === 404) return null;
      throw error;
    }
  }

  async putIfAbsent(key: string, { body, size, job }: Entry): Promise<'stored' | 'exists'> {
    const abort = new AbortController();
    const source = Readable.fromWeb(body as NodeWebStream<Uint8Array>);
    let failure: unknown;
    // Unhandled, a body that fails midway takes the whole process down.
    source.on('error', (error) => {
      failure = error;
      abort.abort();
    });
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: source,
          ContentLength: size,
          ContentType: 'application/octet-stream',
          Metadata: asHeaderValues(job),
          IfNoneMatch: '*',
        }),
        { abortSignal: abort.signal }
      );
      return 'stored';
    } catch (error) {
      if (failure) throw failure;
      // 412: an entry exists. 409: another write of this key is in flight.
      const code = status(error);
      if (code === 412 || code === 409) return 'exists';
      throw error;
    }
  }
}
