import { describe, expect, it } from 'bun:test';
import { createStore } from '../src/store';
import { AzureStore } from '../src/store/azure';
import { GcsStore } from '../src/store/gcs';
import { S3Store } from '../src/store/s3';

describe('createStore', () => {
  it('builds the store STORE names', () => {
    expect(createStore('gcs', 'cache')).toBeInstanceOf(GcsStore);
    expect(createStore('s3', 'cache')).toBeInstanceOf(S3Store);
    expect(createStore('azure', 'account/cache')).toBeInstanceOf(AzureStore);
  });

  it.each([
    ['gcs', 'cache/prefix'],
    ['s3', 'cache/prefix'],
    ['azure', 'account'],
    ['azure', 'account/'],
    ['azure', '/cache'],
    ['azure', 'account/cache/nested'],
  ] as const)('refuses STORE=%s BUCKET=%s', (type, bucket) => {
    expect(() => createStore(type, bucket)).toThrow('BUCKET must be');
  });
});
