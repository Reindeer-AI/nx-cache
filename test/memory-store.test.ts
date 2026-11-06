import { MemoryStore } from './memory-store';
import { describeStore } from './store-contract';

describeStore('MemoryStore', async () => {
  const store = new MemoryStore();
  return {
    store,
    writerOf: async (key) => {
      const job = store.writers.get(key);
      if (!job) throw new Error(`no entry at ${key}`);
      return job;
    },
  };
});
