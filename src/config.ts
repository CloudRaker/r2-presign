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
const envFallbackConfig = {
  accountId: env.R2_ACCOUNT_ID,
  bucket: env.R2_BUCKET_NAME,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
}

const configPropNames = Object.keys(envFallbackConfig) as ReadonlyArray<keyof R2Config>

export interface R2Config {
  accountId?: string
  bucket?: string
  accessKeyId?: string
  secretAccessKey?: string
}

export function resolveR2Config<T extends R2Config>(c: T): T & Required<R2Config> {
  const resolved = { ...envFallbackConfig, ...c } as T & Required<R2Config>
  for (const field of configPropNames) {
    if (!resolved[field]) {
      throw new Error(`Missing R2 config: set ${field} in options or as environment variable.`)
    }
  }
  return resolved
}

export const hostForAccount = (accountId: string): string => `${accountId}.r2.cloudflarestorage.com`
