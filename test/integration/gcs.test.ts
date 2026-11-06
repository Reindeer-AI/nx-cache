import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@google-cloud/storage';
import { GenericContainer, Wait } from 'testcontainers';
import type { Job } from '../../src/auth/job';
import { GcsStore } from '../../src/store/gcs';
import { describeStore } from '../store-contract';

const IMAGE =
  'fsouza/fake-gcs-server:1.56.1@sha256:797ce226d62f947c009dc40246b30cfb456b8473d8241407f9d6f2c04e4d69ef';
const BUCKET = 'nx-cache-test';

const start = async () => {
  // The emulator creates a bucket for each folder under /data at start.
  const data = mkdtempSync(join(tmpdir(), 'nx-cache-gcs-'));
  mkdirSync(join(data, BUCKET));
  const container = await new GenericContainer(IMAGE)
    .withCommand(['-scheme', 'http', '-port', '4443', '-backend', 'memory', '-data', '/data'])
    .withBindMounts([{ source: data, target: '/data', mode: 'ro' }])
    .withExposedPorts(4443)
    .withWaitStrategy(Wait.forHttp('/storage/v1/b', 4443))
    .start();
  // Not STORAGE_EMULATOR_HOST: it sends uploads or reads to a path the emulator doesn't serve.
  const bucket = new Storage({
    projectId: 'test',
    apiEndpoint: `http://${container.getHost()}:${container.getMappedPort(4443)}`,
  }).bucket(BUCKET);
  return {
    store: new GcsStore(bucket),
    writerOf: async (key: string) => {
      const [metadata] = await bucket.file(key).getMetadata();
      return metadata.metadata as unknown as Job;
    },
    stop: () => container.stop(),
  };
};

describeStore('GcsStore against a GCS emulator', start);
