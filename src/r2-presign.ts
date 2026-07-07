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

import { hmacSha256, hashSha256, toHex } from './crypto'
import { hostForAccount, type R2Config, resolveR2Config } from './config'

export interface PresignR2GetOptions extends R2Config {
  key: string
  /** Credential lifetime; defaults to 3600s. */
  ttlSeconds?: number
}

export interface PresignR2PutOptions extends PresignR2GetOptions {
  /**
   * When set, `content-type` is added to the signed headers, so R2 rejects
   * uploads whose `Content-Type` header doesn't match exactly.
   * Omit to leave the uploader free to send any type.
   */
  contentType?: string
}

interface DeprecatedWrappedUrl {
  url: string
}

/**
 * @deprecated use presignR2('PUT', args)
 */
export async function presignR2Put(args: PresignR2PutOptions): Promise<DeprecatedWrappedUrl> {
  return { url: await presignR2('PUT', args) }
}

/**
 * @deprecated use presignR2('GET', args)
 */
export async function presignR2Get(args: PresignR2GetOptions): Promise<DeprecatedWrappedUrl> {
  return { url: await presignR2('GET', args) }
}

export async function presignR2(method: 'GET', options: PresignR2GetOptions): Promise<string>
export async function presignR2(method: 'PUT', options: PresignR2PutOptions): Promise<string>
export async function presignR2(
  method: 'GET' | 'PUT',
  options: PresignR2PutOptions,
): Promise<string> {
  const {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    key,
    ttlSeconds = 3600,
    contentType,
    sessionToken,
  } = resolveR2Config(options)
  const host = hostForAccount(accountId)

  // Signed headers, sorted by lowercase name per SigV4. `content-type` sorts
  // before `host`, so enforcing it just prepends an entry.
  const signedHeaders: [string, string][] = [['host', host]]
  if (contentType != null) {
    signedHeaders.unshift(['content-type', contentType.trim().replace(/\s+/g, ' ')])
  }
  const signedHeaderNames = signedHeaders.map(([name]) => name).join(';')
  const canonicalHeaders = signedHeaders.map(([name, value]) => `${name}:${value}\n`).join('')

  // Encode the object path once from the raw key (per segment, `/` kept literal).
  // The URL uses it as-is; the SigV4 canonical path also RFC3986-encodes `!'()*`.
  const path = `/${bucket}/${key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`
  const canonicalPath = rfc3986(path)
  const url = new URL(`https://${host}${path}`)

  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = datetime.slice(0, 8)
  const credentialScope = `${date}/auto/s3/aws4_request`

  const queryParams = url.searchParams
  queryParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  queryParams.set('X-Amz-Credential', `${accessKeyId}/${credentialScope}`)
  queryParams.set('X-Amz-Date', datetime)
  queryParams.set('X-Amz-Expires', String(ttlSeconds))
  queryParams.set('X-Amz-SignedHeaders', signedHeaderNames)
  // Temp-credential token is a signed query param, so it's part of the canonical query.
  if (sessionToken != null) {
    queryParams.set('X-Amz-Security-Token', sessionToken)
  }

  const canonicalQuery = [...queryParams]
    .map(([k, v]): [string, string] => [
      rfc3986(encodeURIComponent(k)),
      rfc3986(encodeURIComponent(v)),
    ])
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
    await hashSha256(canonicalRequest),
  ].join('\n')

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, date)
  const kRegion = await hmacSha256(kDate, 'auto')
  const kService = await hmacSha256(kRegion, 's3')
  const kSigning = await hmacSha256(kService, 'aws4_request')
  const signature = toHex(await hmacSha256(kSigning, stringToSign))

  queryParams.set('X-Amz-Signature', signature)
  return url.toString()
}

// SigV4 requires RFC 3986 encoding: `! ' ( ) *` beyond what encodeURIComponent covers.
function rfc3986(s: string): string {
  return s.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
