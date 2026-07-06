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

// Presigned PUT — client uploads directly to R2 and must echo the headers.
const { url, headers } = await presignR2Put({
  accountId: env.R2_ACCOUNT_ID,
  bucket: 'uploads',
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  key: 'clients/acme/report.pdf',
  contentLength: file.size,
  contentType: file.type,
  expiresInSeconds: 300,
})
await fetch(url, { method: 'PUT', headers, body: file })

// Presigned GET — short-lived bearer URL for immediate preview/download.
// Do not persist it.
const { url: downloadUrl } = await presignR2Get({
  accountId: env.R2_ACCOUNT_ID,
  bucket: 'uploads',
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  key: 'clients/acme/report.pdf',
  expiresInSeconds: 300,
})
```

Credentials are R2 S3 API tokens (Account → R2 → Manage API tokens), not the
Worker R2 binding.

## Build

```sh
pnpm build          # tsdown → dist/ (ESM + .d.ts)
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest (workerd pool, verifies against aws4fetch oracle)
pnpm lint           # oxlint
pnpm format:check   # oxfmt
```
