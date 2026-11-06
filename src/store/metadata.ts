import type { Job } from '../auth/job';

/** S3 and Azure send metadata as HTTP headers, which carry only ASCII. */
export function asHeaderValues(job: Job): Record<string, string> {
  return Object.fromEntries(
    Object.entries(job).map(([name, value]) => [
      name,
      value.replace(/[^\x20-\x24\x26-\x7e]/gu, encodeURIComponent),
    ])
  );
}
