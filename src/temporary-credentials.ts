/**
 * Mint scoped, expiring R2 credentials entirely locally — no Cloudflare API
 * round-trip. The parent secret HMAC-signs a short-lived JWT describing the
 * grant (bucket, scope, actions, paths); R2 verifies that signature on each
 * request. The derived `accessKeyId` / `secretAccessKey` / `sessionToken` triple
 * signs S3 requests like any other, so it can be handed to a downstream client.
 *
 * @see https://developers.cloudflare.com/r2/api/s3/temporary-credentials/
 * @see https://developers.cloudflare.com/r2/examples/authenticate-r2-temp-credentials/
 */

import { hashSha256, signHs256Jwt } from './crypto'
import { hostForAccount, type R2Config, resolveR2Config } from './config'

/**
 * The `accessKeyId` / `secretAccessKey` here are the *parent* R2 S3 credentials
 * the grant derives from — same fields (and env fallbacks) as the presigners.
 */
export interface CreateR2TempCredentialsOptions extends R2Config {
  scope: R2Scope
  /** Credential lifetime; defaults to 3600s. */
  ttlSeconds?: number
  /** Restrict to specific S3 actions, e.g. `['GetObject', 'HeadObject']`. */
  actions?: R2Action[]
  /** Restrict to key prefixes and/or exact object keys. */
  paths?: { prefixPaths?: string[]; objectPaths?: string[] }
}

export async function createR2TempCredentials(
    options: CreateR2TempCredentialsOptions,
): Promise<R2TempCredentials> {
  const {
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    actions,
    scope,
    paths,
    ttlSeconds = 3600,
  } = resolveR2Config(options)

  const now_s = Math.floor(Date.now() / 1000)

  const jwt = await signHs256Jwt(
      <R2JwtPayload>{
        bucket,
        scope,
        sub: accountId,
        iss: accessKeyId,
        aud: hostForAccount(accountId),
        iat: now_s,
        exp: now_s + ttlSeconds,
        ...(actions?.length ? { actions } : {}),
        ...(paths
            ? { paths: { prefixPaths: paths.prefixPaths ?? [], objectPaths: paths.objectPaths ?? [] } }
            : {}),
      },
      secretAccessKey,
  )

  return {
    accessKeyId,
    // R2 expects the S3 secret to be the hex SHA-256 of the grant JWT.
    secretAccessKey: await hashSha256(jwt),
    sessionToken: btoa(`jwt/${jwt}`),
  }
}

export type R2Scope =
  | 'admin-read-write'
  | 'admin-read-only'
  | 'object-read-write'
  | 'object-read-only'

/**
 * S3 actions grantable to temporary credentials.
 * @see https://developers.cloudflare.com/r2/api/s3/temporary-credentials/#actions
 */
export type R2Action =
  // Read
  | 'HeadObject'
  | 'GetObject'
  | 'GetBucketLocation'
  | 'ListObjectsV1'
  | 'ListObjectsV2'
  | 'ListMultipartUploads'
  | 'ListParts'
  // Write
  | 'PutObject'
  | 'DeleteObject'
  | 'DeleteObjects'
  | 'CopyObject'
  // Multipart
  | 'CreateMultipartUpload'
  | 'UploadPart'
  | 'UploadPartCopy'
  | 'AbortMultipartUpload'
  | 'CompleteMultipartUpload'

export interface R2TempCredentials {
  accessKeyId: string
  secretAccessKey: string
  /**
   * Consumers: Set as env var AWS_SESSION_TOKEN
   * Sent as `X-Amz-Security-Token` header
   */
  sessionToken: string
}

export interface R2JwtPayload {
  alg?: string
  typ?: string
  iss?: string
  sub?: string
  aud?: string
  exp?: number
  iat?: number
  bucket: CreateR2TempCredentialsOptions['bucket']
  scope: CreateR2TempCredentialsOptions['scope']
  actions?: CreateR2TempCredentialsOptions['actions']
  paths?: CreateR2TempCredentialsOptions['paths']
  [k: string]: unknown
}
