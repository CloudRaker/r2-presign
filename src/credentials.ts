/**
 * Any field left unset falls back to an environment variable, matching
 * Cloudflare's R2 conventions (see the R2 FUSE-mount example):
 * `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
 * In Workers these are populated into `process.env` by `nodejs_compat`.
 */
const env = process.env
const defaultCredentials = {
  accountId: env.R2_ACCOUNT_ID,
  bucket: env.R2_BUCKET_NAME,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
}
export type R2Credentials = Partial<Record<keyof typeof defaultCredentials, string>>

export function resolveCredentials<T extends R2Credentials>(c: T): T & Required<R2Credentials> {
  const resolved = { ...defaultCredentials, ...c } as T & Required<R2Credentials>
  for (const field of Object.keys(defaultCredentials) as (keyof R2Credentials)[]) {
    if (!resolved[field]) {
      throw new Error(`Missing R2 credential: set ${field} in options or as environment variable.`)
    }
  }
  return resolved
}
