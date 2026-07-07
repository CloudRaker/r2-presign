# @cloudraker/r2-presign

Presign S3-compatible PUT/GET URLs for a Cloudflare R2 bucket, so a browser can
upload/download directly without proxying bytes through a Worker. Implements
SigV4 with the Web Crypto API — zero runtime dependencies.

## Install

```sh
pnpm add @cloudraker/r2-presign
```

## Usage

```ts
import { presignR2Put, presignR2Get } from '@cloudraker/r2-presign'

// Presigned PUT — client uploads directly to R2.
const { url } = await presignR2Put({
  accountId: env.R2_ACCOUNT_ID,
  bucket: env.R2_BUCKET_NAME,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  key: 'clients/acme/report.pdf',
  expiresInSeconds: 300,
  // Optional: sign the content type so R2 rejects an upload that sends anything
  // else. Omit to let the client PUT any type.
  contentType: 'application/pdf',
})
// The upload must send the signed Content-Type exactly, or R2 returns 403.
await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file })

// Presigned GET — short-lived bearer URL for immediate preview/download.
// Do not persist it.
const { url: downloadUrl } = await presignR2Get({
  accountId: env.R2_ACCOUNT_ID,
  bucket: env.R2_BUCKET_NAME,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  key: 'clients/acme/report.pdf',
  expiresInSeconds: 300,
})
```

Credentials are R2 S3 API tokens (Account → R2 → Manage API tokens), not the
Worker R2 binding.

### Environment variables

The library takes credentials as plain arguments — names are your choice. This
package's own Worker config uses the S3-tool convention, declared as required
secrets in `wrangler.jsonc` (`secrets.required`) so `wrangler types` generates
their types:

| Variable                | Purpose                      |
| ----------------------- | ---------------------------- |
| `R2_ACCOUNT_ID`         | Cloudflare account ID        |
| `R2_BUCKET_NAME`        | R2 bucket name               |
| `AWS_ACCESS_KEY_ID`     | R2 S3 API token — access key |
| `AWS_SECRET_ACCESS_KEY` | R2 S3 API token — secret key |

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
