/**
 * Web Crypto primitives shared by the SigV4 presigner and the temp-credential signer
 */

const encoder = new TextEncoder()

export const hashSha256 = async (input: string): Promise<string> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input))).toHex()

/** HMAC-SHA256 over `data` with `key` (raw bytes, or a UTF-8 string). */
export async function hmacSha256(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
}

// Minimal HS256 JWT: base64url(header).base64url(payload).base64url(HMAC-SHA256).
// Hand-rolled on Web Crypto to keep this package free of runtime dependencies.
const jwtHeader = encoder
  .encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  .toBase64({ alphabet: 'base64url' })

export async function signHs256Jwt(
  claims: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const signingInput = `${jwtHeader}.${encoder.encode(JSON.stringify(claims)).toBase64({ alphabet: 'base64url' })}`
  const signature = await hmacSha256(secret, signingInput)
  return `${signingInput}.${new Uint8Array(signature).toBase64({ alphabet: 'base64url' })}`
}
