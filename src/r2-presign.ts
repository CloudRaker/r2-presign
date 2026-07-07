/**
 * SigV4 query-string presigning for Cloudflare R2's S3-compatible endpoint,
 * implemented with the Web Crypto API — no runtime dependencies.
 *
 * R2 accepts AWS Signature Version 4 against `<account>.r2.cloudflarestorage.com`
 * with region `auto` / service `s3`. For presigned (query-signed) URLs the only
 * signed header is `host`; the payload is signed as `UNSIGNED-PAYLOAD`. Any
 * Content-Type / Content-Length the caller wants enforced on a PUT is returned
 * as headers to echo, matching S3's unsignable-header behavior.
 */

/**
 * Any field left unset falls back to an environment variable, matching
 * Cloudflare's R2 conventions (see the R2 FUSE-mount example):
 * `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
 * In Workers these are populated into `process.env` by `nodejs_compat`.
 */
export interface R2Credentials {
  accountId?: string
  bucket?: string
  accessKeyId?: string
  secretAccessKey?: string
}

export interface PresignR2PutOptions extends R2Credentials {
  key: string
  contentLength: number
  contentType: string
  expiresInSeconds: number
}

export interface PresignR2GetOptions extends R2Credentials {
  key: string
  expiresInSeconds: number
}

export interface PresignR2PutResult {
  url: string
  headers: Record<string, string>
}

export interface PresignR2GetResult {
  url: string
}

const encoder = new TextEncoder()

// process.env is present in Node and in Workers via `nodejs_compat` — one path, no split.
function resolveCreds(c: R2Credentials): Required<R2Credentials> {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  const accountId = c.accountId ?? env.R2_ACCOUNT_ID
  const bucket = c.bucket ?? env.R2_BUCKET_NAME
  const accessKeyId = c.accessKeyId ?? env.AWS_ACCESS_KEY_ID
  const secretAccessKey = c.secretAccessKey ?? env.AWS_SECRET_ACCESS_KEY
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing R2 credentials: set accountId/bucket/accessKeyId/secretAccessKey in options, ' +
        'or R2_ACCOUNT_ID/R2_BUCKET_NAME/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in the environment.',
    )
  }
  return { accountId, bucket, accessKeyId, secretAccessKey }
}

export async function presignR2Put(args: PresignR2PutOptions): Promise<PresignR2PutResult> {
  const url = await presign('PUT', args)
  return {
    url,
    headers: {
      'Content-Length': String(args.contentLength),
      'Content-Type': args.contentType,
    },
  }
}

export async function presignR2Get(args: PresignR2GetOptions): Promise<PresignR2GetResult> {
  return { url: await presign('GET', args) }
}

async function presign(method: 'GET' | 'PUT', options: PresignR2GetOptions): Promise<string> {
  const { key, expiresInSeconds } = options
  const { accountId, accessKeyId, secretAccessKey, bucket } = resolveCreds(options)
  const host = `${accountId}.r2.cloudflarestorage.com`

  const url = new URL(
    `https://${host}/${bucket}/${key
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')}`,
  )

  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = datetime.slice(0, 8)
  const credentialScope = `${date}/auto/s3/aws4_request`

  const queryParams = url.searchParams
  queryParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  queryParams.set('X-Amz-Credential', `${accessKeyId}/${credentialScope}`)
  queryParams.set('X-Amz-Date', datetime)
  queryParams.set('X-Amz-Expires', String(expiresInSeconds))
  queryParams.set('X-Amz-SignedHeaders', 'host')

  const decoded = decodeURIComponent(url.pathname.replace(/\+/g, ' '))
  const canonicalPath = rfc3986(encodeURIComponent(decoded).replace(/%2F/g, '/'))

  const canonicalQuery = [...queryParams]
    .map(([k, v]) => [rfc3986(encodeURIComponent(k)), rfc3986(encodeURIComponent(v))])
    .toSorted((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    credentialScope,
    toHex(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest))),
  ].join('\n')

  const kDate = await hmac(`AWS4${secretAccessKey}`, date)
  const kRegion = await hmac(kDate, 'auto')
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = toHex(await hmac(kSigning, stringToSign))

  queryParams.set('X-Amz-Signature', signature)
  return url.toString()
}

// Uint8Array.prototype.toHex ships in workerd but not yet in Node — do it portably.
function toHex(buf: ArrayBuffer): string {
  let hex = ''
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0')
  return hex
}

// SigV4 requires RFC 3986 encoding: `! ' ( ) *` beyond what encodeURIComponent covers.
function rfc3986(s: string): string {
  return s.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

async function hmac(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
}
