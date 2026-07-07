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
import { type R2Credentials, resolveCredentials } from './credentials'

export type R2Scope =
  | 'admin-read-write'
  | 'admin-read-only'
  | 'object-read-write'
  | 'object-read-only'

/**
 * The `accessKeyId` / `secretAccessKey` here are the *parent* R2 S3 credentials
 * the grant derives from — same fields (and env fallbacks) as the presigners.
 */
export interface CreateR2TempCredentialsOptions extends R2Credentials {
  scope: R2Scope
  /** Credential lifetime; defaults to 3600s. */
  ttlSeconds?: number
  /** Restrict to specific S3 actions, e.g. `['GetObject', 'HeadObject']`. */
  actions?: string[]
  /** Restrict to key prefixes and/or exact object keys. */
  paths?: { prefixPaths?: string[]; objectPaths?: string[] }
}

export interface R2TempCredentials {
  accessKeyId: string
  secretAccessKey: string
  // Sent as `X-Amz-Security-Token` header
  sessionToken: string
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
  } = resolveCredentials(options)

  const now_s = Math.floor(Date.now() / 1000)

  const claims: Record<string, unknown> = {
    bucket,
    scope,
    sub: accountId,
    iss: accessKeyId,
    aud: `${accountId}.r2.cloudflarestorage.com`,
    iat: now_s,
    exp: now_s + ttlSeconds,
  }
  if (actions?.length) {
    claims.actions = actions
  }
  if (paths) {
    claims.paths = {
      prefixPaths: paths.prefixPaths ?? [],
      objectPaths: paths.objectPaths ?? [],
    }
  }

  const jwt = await signHs256Jwt(claims, secretAccessKey)
  return {
    accessKeyId,
    // R2 expects the S3 secret to be the hex SHA-256 of the grant JWT.
    secretAccessKey: await hashSha256(jwt),
    sessionToken: btoa(`jwt/${jwt}`),
  }
}
