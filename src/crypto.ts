/**
 * Web Crypto primitives shared by the SigV4 presigner and the temp-credential signer
 */

const encoder = new TextEncoder()

export async function hashSha256(input: string): Promise<string> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input))).toHex()
}

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
const jwtHeader = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))

export async function signHs256Jwt(
  claims: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const signingInput = `${jwtHeader}.${base64url(JSON.stringify(claims))}`
  const signature = await hmacSha256(secret, signingInput)
  return `${signingInput}.${base64urlBytes(new Uint8Array(signature))}`
}

function base64url(str: string): string {
  return base64urlBytes(encoder.encode(str))
}

function base64urlBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
