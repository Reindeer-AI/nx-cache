# nx-cache

A remote cache server for [Nx](https://nx.dev) that keeps its entries in your own bucket: Google
Cloud Storage, Amazon S3 or Azure Blob Storage. It implements
[Nx's self-hosted cache API](https://nx.dev/docs/kb/self-hosted-caching), so it needs Nx 20.8 or
newer and no Nx plugin.

## Why a server, and not a bucket plugin

A cache that every CI job can write to can be poisoned (CVE-2025-36852, "CREEP"): a pull request
uploads a doctored build under the hash `main` will compute later, and `main` restores it. Bucket
credentials can't tell those two jobs apart.

This server can, because CI never holds a credential. Each job proves who it is with a GitHub OIDC
token, whose `ref` and `event_name` GitHub signs and a pull request can't change, even by editing
its workflow. Entries live in namespaces, and the token decides which ones a job may use:

| Caller | Reads | Writes |
| --- | --- | --- |
| A job on the default branch (`push`, `schedule`) | `main` | `main` |
| A `pull_request` job for PR N | `pr-N`, then `main` | `pr-N` |
| Anything else | `main` | nothing |

The default branch never reads a pull request's namespace, and no pull request reads another's. An
entry is never replaced: a second write of the same hash gets 409, and the bucket enforces it with
a conditional write.

If you're the only contributor to your repository, you don't need this, and a bucket plugin is
simpler. It's for repositories that take pull requests from people or tools you don't fully trust.

## Limits

- GitHub Actions only, because GitHub is the only source of identity.
- One repository per server. Repositories sharing a server would share `main`.
- No cache on a laptop: only a GitHub Actions job can get a token.
- No remote cache for pull requests from forks: GitHub gives them no OIDC token, so they run with
  Nx's local cache.
- A cache token lasts an hour, so a job that runs longer needs a new one.
- An entry can be up to 2 GiB.

## Set it up

### 1. Create a private bucket

Give the machine that will run the server access to the bucket, and to nothing else:

| Bucket | Access |
| --- | --- |
| GCS | `roles/storage.objectCreator` and `roles/storage.objectViewer` |
| S3 | `s3:GetObject` and `s3:PutObject` on its objects, and `s3:ListBucket` on the bucket. Without `s3:ListBucket`, S3 answers a miss with 403 instead of 404. |
| Azure | `Storage Blob Data Contributor` on the storage account, and an existing container |

Add lifecycle rules, because the server never deletes anything. Delete objects under the `pr-`
prefix after 7 days and under `main/` after 30.

### 2. Run the server

Run it where GitHub's runners can reach it over HTTPS. A small VM in the bucket's cloud is the
setup to start from: its machine identity gives the server access to the bucket without static
keys.

```bash
docker run -d --restart=always -p 127.0.0.1:8080:8080 \
  -e STORE=s3 \
  -e BUCKET=my-nx-cache \
  -e AWS_REGION=us-east-1 \
  -e OIDC_AUDIENCE=https://cache.example.com \
  -e GITHUB_REPOSITORY_ID="$(gh api repos/OWNER/REPO -q .id)" \
  -e TOKEN_KEY="$(openssl rand -base64 32)" \
  ghcr.io/reindeer-ai/nx-cache:<version>
```

Keep `TOKEN_KEY` secret and stable: anyone holding it can write to `main`, and changing it
invalidates the tokens issued. In front of it, any proxy that doesn't cap request bodies works. With
[Caddy](https://caddyserver.com), which also gets the certificate:

```
cache.example.com {
  reverse_proxy localhost:8080
}
```

Check any other platform's request size limit first. Cloud Run, for one, limits HTTP/1 requests to
32 MiB, and cache entries can be larger.

### 3. Use it in your workflow

The job needs `id-token: write`, and the step goes before Nx runs:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: actions/checkout@v5
  - uses: Reindeer-AI/nx-cache@v<version>
    with:
      url: https://cache.example.com
  - run: npx nx affected -t build test
```

If the server can't be reached, the step prints a notice and Nx runs with its local cache, so an
outage slows CI without failing it.

## Configuration

| Variable | |
| --- | --- |
| `STORE` | `gcs`, `s3` or `azure`. Credentials come from each cloud's default chain. |
| `BUCKET` | Where the entries live, as `<namespace>/<hash>`: the bucket's name, or `account/container` with `azure`. |
| `OIDC_AUDIENCE` | The server's URL, exactly as the workflow's `url` gives it. |
| `GITHUB_REPOSITORY_ID` | The repository whose jobs may use the cache, by ID (`gh api repos/OWNER/REPO -q .id`). |
| `TOKEN_KEY` | 32 random bytes, base64. Signs cache tokens. |
| `GITHUB_DEFAULT_BRANCH` | The branch whose jobs write the shared namespace. Defaults to `main`. The namespace is called `main` either way. |
| `AWS_REGION` | The bucket's region, with `s3`. |
| `AWS_ENDPOINT_URL_S3` | An S3-compatible service's endpoint, with `s3`. Turns on path-style addressing. The service must honor `If-None-Match: *`, or entries can be replaced. |
| `PORT` | Defaults to 3000 outside the image, and to 8080 in it. |

Each entry's object metadata records the job that wrote it (`sub`, `run_id`, `sha` and
`workflow_ref`), and the server logs them, so a suspect entry says which run produced it.

## Develop

`bun install`, then:

- `biome check .` and `tsc --noEmit`.
- `bun test ./test --path-ignore-patterns='test/integration/**'` covers the grant, the token
  exchange and the API over an in-memory store. It needs no Docker.
- `bun test ./test/integration` runs one contract suite (`test/store-contract.ts`) against each
  store over an emulator in Docker: `GcsStore` on `fsouza/fake-gcs-server`, `AzureStore` on Azurite
  and `S3Store` on LocalStack.

`contract/nx-self-hosted-cache.openapi.json` is Nx's spec, copied unchanged from
[its documentation](https://nx.dev/docs/kb/self-hosted-caching). Nx is MIT-licensed, © Narwhal
Technologies Inc. The server answers only with the statuses it lists, which `test/spec.test.ts`
checks, except 411 for a `PUT` without the `Content-Length` it requires.

## License

Apache-2.0.
