import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { Storage } from '@google-cloud/storage';
import { AzureStore } from './azure';
import { GcsStore } from './gcs';
import { S3Store } from './s3';
import type { Store } from './store';

export type StoreType = 'gcs' | 's3' | 'azure';

/**
 * The store STORE and BUCKET name, signed in with the platform's default credentials.
 * Throws, so a wrong BUCKET stops the server at startup.
 */
export function createStore(
  type: StoreType,
  bucket: string,
  options: { s3Endpoint?: string } = {}
): Store {
  if (type === 'azure') {
    const [account, container, ...rest] = bucket.split('/');
    if (!account || !container || rest.length > 0) {
      throw new Error('BUCKET must be account/container when STORE is azure');
    }
    const service = new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      new DefaultAzureCredential()
    );
    return new AzureStore(service.getContainerClient(container));
  }
  if (bucket.includes('/')) throw new Error(`BUCKET must be a bucket's name when STORE is ${type}`);
  if (type === 'gcs') return new GcsStore(new Storage().bucket(bucket));
  // S3-compatible services rarely serve bucket subdomains. The SDK reads the endpoint itself.
  return new S3Store(bucket, { forcePathStyle: Boolean(options.s3Endpoint) });
}
