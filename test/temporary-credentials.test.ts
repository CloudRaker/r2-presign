import { afterEach, describe, expect, it, vi } from 'vitest'

import { createR2TempCredentials } from '../src/temporary-credentials'

const parent = {
  accountId: 'acct123',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  bucket: 'uploads',
} as const

const enc = new TextEncoder()

/** The `sessionToken` is `btoa("jwt/" + jwt)` — recover the raw JWT. */
function jwtFromSessionToken(sessionToken: string): string {
  const decoded = atob(sessionToken)
  expect(decoded.startsWith('jwt/')).toBe(true)
  return decoded.slice(4)
}

function decodeSegment(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(b64))
}

/** Independent HS256 check: re-sign the header.payload and compare the tag. */
async function signatureValid(jwt: string, secret: string): Promise<boolean> {
  const [header, payload, signature] = jwt.split('.')
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const sigBytes = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  )
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${header}.${payload}`))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createR2TempCredentials', () => {
  it('returns the parent key id and a hex sha256 secret', async () => {
    const creds = await createR2TempCredentials({ ...parent, scope: 'object-read-only' })
    expect(creds.accessKeyId).toBe(parent.accessKeyId)
    expect(creds.secretAccessKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('secretAccessKey is the hex sha256 of the exact grant JWT', async () => {
    const creds = await createR2TempCredentials({ ...parent, scope: 'object-read-only' })
    const jwt = jwtFromSessionToken(creds.sessionToken)
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(jwt))
    expect(creds.secretAccessKey).toBe(new Uint8Array(digest).toHex())
  })

  it('signs a valid HS256 JWT carrying the scoped claims', async () => {
    const creds = await createR2TempCredentials({
      ...parent,
      scope: 'object-read-write',
      ttlSeconds: 900,
      actions: ['GetObject', 'PutObject'],
      paths: { prefixPaths: ['data/'] },
    })
    const jwt = jwtFromSessionToken(creds.sessionToken)

    expect(decodeSegment(jwt.split('.')[0])).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(await signatureValid(jwt, parent.secretAccessKey)).toBe(true)
    expect(await signatureValid(jwt, 'wrong-secret')).toBe(false)

    const payload = decodeSegment(jwt.split('.')[1])
    expect(payload.bucket).toBe('uploads')
    expect(payload.scope).toBe('object-read-write')
    expect(payload.actions).toEqual(['GetObject', 'PutObject'])
    expect(payload.paths).toEqual({ prefixPaths: ['data/'], objectPaths: [] })
    expect(payload.iss).toBe(parent.accessKeyId)
    expect(payload.sub).toBe(parent.accountId)
    expect(payload.aud).toBe(`${parent.accountId}.r2.cloudflarestorage.com`)
    expect((payload.exp as number) - (payload.iat as number)).toBe(900)
  })

  it('omits actions/paths when not scoped, defaults ttl to 3600s', async () => {
    const creds = await createR2TempCredentials({ ...parent, scope: 'admin-read-write' })
    const payload = decodeSegment(jwtFromSessionToken(creds.sessionToken).split('.')[1])
    expect(payload).not.toHaveProperty('actions')
    expect(payload).not.toHaveProperty('paths')
    expect((payload.exp as number) - (payload.iat as number)).toBe(3600)
  })

  it('throws when required config is missing', async () => {
    // Every field is optional (env fallback); clear one so nothing resolves.
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', '')
    await expect(
      createR2TempCredentials({
        accountId: 'a',
        accessKeyId: 'k',
        bucket: 'b',
        scope: 'object-read-only',
      }),
    ).rejects.toThrow(/Missing R2 credential/)
  })
})
