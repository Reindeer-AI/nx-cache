/** The namespaces a caller reads, first match wins, and the one it may write, if any. */
export interface Grant {
  read: string[];
  write: string | null;
}

export interface JobClaims {
  ref: string;
  event_name: string;
}

/** The shared namespace keeps this name whatever the default branch is called. */
const SHARED = 'main';
/** Events whose workflow and code both come from the ref they run on. */
const RUNS_ITS_OWN_REF = new Set(['push', 'schedule']);
const PULL_REQUEST = /^refs\/pull\/(\d+)\/merge$/;

/**
 * Only code that reached the default branch writes the shared namespace. A pull request writes
 * its own, which nothing else reads, so it can't plant a result that the default branch or
 * another pull request restores. Everything else reads the shared namespace and writes nothing.
 */
export function grantFor(claims: JobClaims, defaultBranch: string): Grant {
  if (claims.ref === `refs/heads/${defaultBranch}` && RUNS_ITS_OWN_REF.has(claims.event_name)) {
    return { read: [SHARED], write: SHARED };
  }
  const pull = PULL_REQUEST.exec(claims.ref);
  if (pull && claims.event_name === 'pull_request') {
    const own = `pr-${pull[1]}`;
    return { read: [own, SHARED], write: own };
  }
  return { read: [SHARED], write: null };
}
