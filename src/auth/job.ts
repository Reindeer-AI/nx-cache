/** The GitHub job a cache token was issued to; each entry it writes records it. */
export interface Job {
  sub: string;
  run_id: string;
  sha: string;
  workflow_ref: string;
}

/** The job claims, or null unless each is a string, as GitHub always sends them. */
export function jobOf(claims: Record<string, unknown>): Job | null {
  const { sub, run_id, sha, workflow_ref } = claims;
  if (typeof sub !== 'string' || typeof run_id !== 'string') return null;
  if (typeof sha !== 'string' || typeof workflow_ref !== 'string') return null;
  return { sub, run_id, sha, workflow_ref };
}
