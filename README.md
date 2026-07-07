# @cloudraker/r2-presign

Presign S3-compatible PUT/GET URLs for a Cloudflare R2 bucket — so a browser can
upload/download directly without proxying bytes through a Worker — and mint
scoped, expiring temporary credentials. All built on the Web Crypto API, with
zero runtime dependencies.

## Install

```sh
pnpm add @cloudraker/r2-presign
```

## Usage

```ts
import { presignR2 } from '@cloudraker/r2-presign'

// Presigned PUT — client uploads directly to R2.
const url = await presignR2('PUT', {
  accountId: env.R2_ACCOUNT_ID,
  bucket: env.R2_BUCKET_NAME,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  key: 'clients/acme/report.pdf',
  ttlSeconds: 300, // optional, defaults to 3600
  // Optional: sign the content type so R2 rejects an upload that sends anything
  // else. Omit to let the client PUT any type.
  contentType: 'application/pdf',
})
// The upload must send the signed Content-Type exactly, or R2 returns 403.
await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file })

// Presigned GET — short-lived bearer URL for immediate preview/download.
// Do not persist it. Any field left unset falls back to its env var, so with
// R2_ACCOUNT_ID / R2_BUCKET_NAME / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY set,
// only `key` is required.
const downloadUrl = await presignR2('GET', { key: 'clients/acme/report.pdf', ttlSeconds: 300 })
```

Credentials are R2 S3 API tokens (Account → R2 → Manage API tokens), not the
Worker R2 binding.

To presign with **temporary credentials**, pass the `sessionToken` (falls back to
`AWS_SESSION_TOKEN`) alongside the derived key pair — it's signed into the URL as
`X-Amz-Security-Token`:

```ts
const creds = await createR2TempCredentials({ scope: 'object-read-only', ttlSeconds: 3600 })
const downloadUrl = await presignR2('GET', { ...creds, key: 'clients/acme/report.pdf' })
```

### Temporary credentials

Use temporary credentials when a caller needs a short S3 session instead of one
single presigned URL: for example, several reads under one prefix, or a direct
upload flow that should use an S3-compatible client.

`createR2TempCredentials` signs the grant locally with your parent R2 S3 secret.
That means there is no Cloudflare API call, but the parent secret must stay in a
trusted environment such as your backend or Worker. The returned values are the
standard S3 credential triple: `accessKeyId`, `secretAccessKey`, and
`sessionToken`.

```ts
import { createR2TempCredentials } from '@cloudraker/r2-presign'
import { AwsClient } from 'aws4fetch'

const creds = await createR2TempCredentials({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET_NAME,
  scope: 'object-read-only', // | object-read-write | admin-read-only | admin-read-write
  ttlSeconds: 3600,
  actions: ['GetObject', 'HeadObject'], // optional finer-grained actions
  paths: { prefixPaths: ['clients/acme/'] }, // optional; also `objectPaths: [...]`
})

// aws4fetch sends `sessionToken` as X-Amz-Security-Token automatically.
const client = new AwsClient({ ...creds, service: 's3', region: 'auto' })
const res = await client.fetch(
  `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/clients/acme/report.pdf`,
)
```

Temporary credentials can never exceed the parent token's permissions. Keep TTLs
short and scope both actions and paths as narrowly as the client workflow allows.

### Environment variables

Any argument left unset falls back to an environment variable (via `process.env`,
populated by `nodejs_compat` in Workers). The required four are declared as
secrets in `wrangler.jsonc` (`secrets.required`) so `wrangler types` generates
their types; `AWS_SESSION_TOKEN` is optional and only used for temporary
credentials.

| Variable                | Purpose                                | Required |
| ----------------------- | -------------------------------------- | -------- |
| `R2_ACCOUNT_ID`         | Cloudflare account ID                  | yes      |
| `R2_BUCKET_NAME`        | R2 bucket name                         | yes      |
| `AWS_ACCESS_KEY_ID`     | R2 S3 API token — access key           | yes      |
| `AWS_SECRET_ACCESS_KEY` | R2 S3 API token — secret key           | yes      |
| `AWS_SESSION_TOKEN`     | Session token for temporary creds      | no       |

`R2_*` for R2-specific values, `AWS_*` for the S3 credential pair (reused as-is
by the AWS SDK / `aws4fetch`). Set them in `.dev.vars` locally and via
`wrangler secret put` in production.

## Build

```sh
pnpm build          # tsdown → dist/ (ESM + .d.ts)
pnpm typecheck      # tsc --noEmit (src + both test tsconfigs)
pnpm test           # unit test in node + workers pools (vs aws4fetch oracle)
pnpm test:e2e       # round-trip against real R2 (needs .dev.vars secrets)
pnpm lint           # oxlint
pnpm format:check   # oxfmt
pnpm cf-typegen     # regenerate worker-configuration.d.ts from wrangler.jsonc
```
