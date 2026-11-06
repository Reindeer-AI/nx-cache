import { BlobServiceClient } from '@azure/storage-blob';
import { GenericContainer, Wait } from 'testcontainers';
import type { Job } from '../../src/auth/job';
import { AzureStore } from '../../src/store/azure';
import { describeStore } from '../store-contract';

const IMAGE =
  'mcr.microsoft.com/azure-storage/azurite:3.37.0@sha256:830430c1da1a2d537e08f3e6764dd1f5ae00cf0346bcaf625b968ec3f0971fd5';
// Azurite's documented development account.
const ACCOUNT = 'devstoreaccount1';
const KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='; // gitleaks:allow

const start = async () => {
  const azurite = await new GenericContainer(IMAGE)
    .withCommand([
      'azurite-blob',
      '--blobHost',
      '0.0.0.0',
      '--inMemoryPersistence',
      '--skipApiVersionCheck',
    ])
    .withExposedPorts(10000)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const endpoint = `http://${azurite.getHost()}:${azurite.getMappedPort(10000)}/${ACCOUNT}`;
  const connection = `DefaultEndpointsProtocol=http;AccountName=${ACCOUNT};AccountKey=${KEY};BlobEndpoint=${endpoint};`;
  const container = BlobServiceClient.fromConnectionString(connection).getContainerClient('cache');
  await container.create();
  return {
    store: new AzureStore(container),
    writerOf: async (key: string) => {
      const { metadata = {} } = await container.getBlobClient(key).getProperties();
      const decoded = Object.entries(metadata).map(([k, v]) => [k, decodeURIComponent(v)]);
      return Object.fromEntries(decoded) as unknown as Job;
    },
    stop: () => azurite.stop(),
  };
};

describeStore('AzureStore against Azurite', start);
