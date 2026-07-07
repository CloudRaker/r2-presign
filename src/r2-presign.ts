/**
 * SigV4 query-string presigning for Cloudflare R2's S3-compatible endpoint,
 * implemented with the Web Crypto API — no runtime dependencies.
 *
 * R2 accepts AWS Signature Version 4 against `<account>.r2.cloudflarestorage.com`
 * with region `auto` / service `s3`. For presigned (query-signed) URLs the
 * payload is signed as `UNSIGNED-PAYLOAD` and only `host` is signed by default.
 * A PUT may optionally sign `content-type` too, which makes R2 enforce that the
 * upload sends that exact Content-Type.
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

export interface PresignR2GetOptions extends R2Credentials {
  key: string
  expiresInSeconds: number
}

export interface PresignR2PutOptions extends PresignR2GetOptions {
  // When set, `content-type` is added to the signed headers, so R2 rejects any
  // upload whose `Content-Type` header doesn't match exactly. Omit to leave the
  // uploader free to send any type.
  contentType?: string
}

const encoder = new TextEncoder()

// process.env is present in Node and in Workers via `nodejs_compat`
function resolveCreds<T extends R2Credentials>(c: T): T & Required<R2Credentials> {
  const env = process.env ?? {}
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
  return { ...c, accountId, bucket, accessKeyId, secretAccessKey }
}

interface DeprecatedWrappedUrl {
  url: string
}

/**
 * @deprecated use presign('PUT', args)
 */
export async function presignR2Put(args: PresignR2PutOptions): Promise<DeprecatedWrappedUrl> {
  return { url: await presign('PUT', args) }
}

/**
 * @deprecated use presign('GET', args)
 */
export async function presignR2Get(args: PresignR2GetOptions): Promise<DeprecatedWrappedUrl> {
  return { url: await presign('GET', args) }
}

export async function presign(method: 'GET', options: PresignR2GetOptions): Promise<string>
export async function presign(method: 'PUT', options: PresignR2PutOptions): Promise<string>
export async function presign(
  method: 'GET' | 'PUT',
  options: PresignR2PutOptions,
): Promise<string> {
  const { accountId, accessKeyId, secretAccessKey, bucket, key, expiresInSeconds, contentType } =
    resolveCreds(options)
  const host = `${accountId}.r2.cloudflarestorage.com`

  // Signed headers, sorted by lowercase name per SigV4. `content-type` sorts
  // before `host`, so enforcing it just prepends an entry.
  const signedHeaders: [string, string][] = [['host', host]]
  if (contentType != null) {
    signedHeaders.unshift(['content-type', contentType.trim().replace(/\s+/g, ' ')])
  }
  const signedHeaderNames = signedHeaders.map(([name]) => name).join(';')
  const canonicalHeaders = signedHeaders.map(([name, value]) => `${name}:${value}\n`).join('')

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
  queryParams.set('X-Amz-SignedHeaders', signedHeaderNames)

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
    canonicalHeaders,
    signedHeaderNames,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    credentialScope,
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest))).toHex(),
  ].join('\n')

  const kDate = await hmac(`AWS4${secretAccessKey}`, date)
  const kRegion = await hmac(kDate, 'auto')
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = new Uint8Array(await hmac(kSigning, stringToSign)).toHex()

  queryParams.set('X-Amz-Signature', signature)
  return url.toString()
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
