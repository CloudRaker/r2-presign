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

export interface R2Credentials {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
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

async function presign(method: 'GET' | 'PUT', args: PresignR2GetOptions): Promise<string> {
  const host = `${args.accountId}.r2.cloudflarestorage.com`
  const encodedKey = args.key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  const url = new URL(`https://${host}/${args.bucket}/${encodedKey}`)

  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = datetime.slice(0, 8)
  const credentialScope = `${date}/auto/s3/aws4_request`

  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  url.searchParams.set('X-Amz-Credential', `${args.accessKeyId}/${credentialScope}`)
  url.searchParams.set('X-Amz-Date', datetime)
  url.searchParams.set('X-Amz-Expires', String(args.expiresInSeconds))
  url.searchParams.set('X-Amz-SignedHeaders', 'host')

  const decoded = decodeURIComponent(url.pathname.replace(/\+/g, ' '))
  const canonicalPath = rfc3986(encodeURIComponent(decoded).replace(/%2F/g, '/'))

  const canonicalQuery = [...url.searchParams]
    .map(([k, v]) => [rfc3986(encodeURIComponent(k)), rfc3986(encodeURIComponent(v))])
    .toSorted((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
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
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest))).toHex(),
  ].join('\n')

  const kDate = await hmac(`AWS4${args.secretAccessKey}`, date)
  const kRegion = await hmac(kDate, 'auto')
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = new Uint8Array(await hmac(kSigning, stringToSign)).toHex()

  url.searchParams.set('X-Amz-Signature', signature)
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
