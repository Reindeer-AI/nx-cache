import { CreateBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait } from 'testcontainers';
import type { Job } from '../../src/auth/job';
import { S3Store } from '../../src/store/s3';
import { describeStore } from '../store-contract';

const IMAGE =
  'localstack/localstack:4.8.1@sha256:8c9756bddc44625cd6e890f5e4bcc29b045eebe108b268482b848f4f832ec153';
const BUCKET = 'nx-cache-test';

const start = async () => {
  const container = await new GenericContainer(IMAGE)
    .withExposedPorts(4566)
    .withWaitStrategy(Wait.forHttp('/_localstack/health', 4566))
    .start();
  const config = {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(4566)}`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  };
  const client = new S3Client(config);
  await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  return {
    store: new S3Store(BUCKET, config),
    writerOf: async (key: string) => {
      const { Metadata = {} } = await client.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: key })
      );
      const decoded = Object.entries(Metadata).map(([k, v]) => [k, decodeURIComponent(v)]);
      return Object.fromEntries(decoded) as unknown as Job;
    },
    stop: () => container.stop(),
  };
};

describeStore('S3Store against LocalStack', start);
