/**
 * Any field left unset falls back to an environment variable, matching
 * AWS SDK:
 * https://docs.aws.amazon.com/sdkref/latest/guide/feature-static-credentials.html
 * and
 * Cloudflare's R2 conventions:
 * https://developers.cloudflare.com/containers/examples/r2-fuse-mount/
 * In Workers these are populated into `process.env` by `nodejs_compat`.
 */
const env = process.env
const requiredEnvFallback = {
  accountId: env.R2_ACCOUNT_ID,
  bucket: env.R2_BUCKET_NAME,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
}

const requiredPropNames = Object.keys(
  requiredEnvFallback,
) as ReadonlyArray<keyof typeof requiredEnvFallback>

export interface R2Config {
  /** Cloudflare account ID; falls back to `R2_ACCOUNT_ID`. */
  accountId?: string
  /** R2 bucket name; falls back to `R2_BUCKET_NAME`. */
  bucket?: string
  /** R2 access key ID; falls back to `AWS_ACCESS_KEY_ID`. */
  accessKeyId?: string
  /** R2 secret access key; falls back to `AWS_SECRET_ACCESS_KEY`. */
  secretAccessKey?: string
  /**
   * Session token for AWS temporary credentials; falls back to `AWS_SESSION_TOKEN`.
   * Optional — only set when signing with temporary credentials.
   */
  sessionToken?: string
}

type ResolvedR2Config<T> = T & Required<Omit<R2Config, 'sessionToken'>> & Pick<R2Config, 'sessionToken'>

export function resolveR2Config<T extends R2Config>(c: T): ResolvedR2Config<T> {
  const resolved = {
    ...requiredEnvFallback,
    sessionToken: env['AWS_SESSION_TOKEN'],
    ...c,
  } as ResolvedR2Config<T>
  for (const field of requiredPropNames) {
    if (!resolved[field]) {
      throw new Error(`Missing R2 config: set ${field} in options or as environment variable.`)
    }
  }
  return resolved
}

export const hostForAccount = (accountId: string): string => `${accountId}.r2.cloudflarestorage.com`
