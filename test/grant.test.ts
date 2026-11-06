import { describe, expect, it } from 'bun:test';
import { grantFor as grantForBranch, type JobClaims } from '../src/auth/grant';

const grantFor = (claims: JobClaims) => grantForBranch(claims, 'main');

describe('grantFor', () => {
  it('lets main write the shared namespace', () => {
    for (const event_name of ['push', 'schedule']) {
      expect(grantFor({ ref: 'refs/heads/main', event_name })).toEqual({
        read: ['main'],
        write: 'main',
      });
    }
  });

  it('gives a pull request its own namespace, read before main', () => {
    expect(grantFor({ ref: 'refs/pull/2342/merge', event_name: 'pull_request' })).toEqual({
      read: ['pr-2342', 'main'],
      write: 'pr-2342',
    });
  });

  it('never lets a job claiming main through another event write', () => {
    // pull_request_target runs with the base ref but may check out the pull request's code.
    expect(grantFor({ ref: 'refs/heads/main', event_name: 'pull_request_target' })).toEqual({
      read: ['main'],
      write: null,
    });
  });

  it('uses the configured default branch, keeping the namespace name', () => {
    const ref = 'refs/heads/master';
    expect(grantForBranch({ ref, event_name: 'push' }, 'master')).toEqual({
      read: ['main'],
      write: 'main',
    });
    expect(grantForBranch({ ref: 'refs/heads/main', event_name: 'push' }, 'master')).toEqual({
      read: ['main'],
      write: null,
    });
  });

  it('lets other branches and events only read main', () => {
    for (const claims of [
      { ref: 'refs/heads/main', event_name: 'workflow_dispatch' },
      { ref: 'refs/heads/feature', event_name: 'push' },
      { ref: 'refs/heads/feature', event_name: 'workflow_dispatch' },
      { ref: 'refs/heads/main-copy', event_name: 'push' },
      { ref: 'refs/pull/7/head', event_name: 'pull_request' },
      { ref: 'refs/pull/7/merge', event_name: 'pull_request_target' },
      { ref: 'refs/tags/v1', event_name: 'push' },
    ]) {
      expect(grantFor(claims)).toEqual({ read: ['main'], write: null });
    }
  });
});
