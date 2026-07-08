import { AwsClient } from 'aws4fetch'
import { describe, expect, it } from 'vitest'

import { presignR2 } from '../src/r2-presign'

const creds = {
  accountId: 'abc123def456',
  bucket: 'uploads',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  // Spaces, accents, parens, nested path — exercises the key/path encoding.
  key: 'clients/acme/rapport final (v2).pdf',
}

/**
 * Reference URL from aws4fetch (the trusted SigV4 implementation), pinned to the
 * same datetime our signer used so the comparison is deterministic — no clock mocking.
 */
async function oracle(
  method: 'GET' | 'PUT',
  datetime: string,
  headers?: Record<string, string>,
  sessionToken?: string,
): Promise<URL> {
  const client = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
    service: 's3',
    region: 'auto',
  })
  const encKey = creds.key.split('/').map(encodeURIComponent).join('/')
  const url = new URL(
    `https://${creds.accountId}.r2.cloudflarestorage.com/${creds.bucket}/${encKey}`,
  )
  url.searchParams.set('X-Amz-Expires', '300')
  // aws4fetch treats content-type as unsignable by default; allHeaders forces it
  // into SignedHeaders so the oracle matches an enforced content-type.
  const signed = await client.sign(
    new Request(url.toString(), headers ? { method, headers } : { method }),
    {
      aws: { signQuery: true, datetime, allHeaders: headers !== undefined },
    },
  )
  return new URL(signed.url)
}

/** Query params as a plain object, order-independent. */
function params(url: string | URL): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams)
}

describe('presignR2 PUT', () => {
  it('produces the same signature + params as aws4fetch', async () => {
    const url = await presignR2('PUT', { ...creds, ttlSeconds: 300 })
    const ref = await oracle('PUT', params(url)['X-Amz-Date']!)
    expect(new URL(url).pathname).toBe(ref.pathname)
    expect(params(url)).toEqual(params(ref))
  })

  it('signs content-type when set, matching aws4fetch', async () => {
    const url = await presignR2('PUT', {
      ...creds,
      contentType: 'application/pdf',
      ttlSeconds: 300,
    })
    expect(params(url)['X-Amz-SignedHeaders']).toBe('content-type;host')
    const ref = await oracle('PUT', params(url)['X-Amz-Date']!, {
      'content-type': 'application/pdf',
    })
    expect(params(url)).toEqual(params(ref))
  })
})

describe('presignR2 GET', () => {
  it('produces the same signature + params as aws4fetch', async () => {
    const url = await presignR2('GET', { ...creds, ttlSeconds: 300 })
    const ref = await oracle('GET', params(url)['X-Amz-Date']!)
    expect(new URL(url).pathname).toBe(ref.pathname)
    expect(params(url)).toEqual(params(ref))
  })

  it('signs X-Amz-Security-Token for temp credentials, matching aws4fetch', async () => {
    const sessionToken = 'FQoGZXIvYXdzEExampleSessionToken=='
    const url = await presignR2('GET', { ...creds, ttlSeconds: 300, sessionToken })
    expect(params(url)['X-Amz-Security-Token']).toBe(sessionToken)
    const ref = await oracle('GET', params(url)['X-Amz-Date']!, undefined, sessionToken)
    expect(params(url)).toEqual(params(ref))
  })

  it('signs X-Amz-Security-Token for PUT with temp credentials, matching aws4fetch', async () => {
    const sessionToken = 'FQoGZXIvYXdzEExampleSessionToken=='
    const url = await presignR2('PUT', { ...creds, ttlSeconds: 300, sessionToken })
    expect(params(url)['X-Amz-Security-Token']).toBe(sessionToken)
    const ref = await oracle('PUT', params(url)['X-Amz-Date']!, undefined, sessionToken)
    expect(params(url)).toEqual(params(ref))
  })

  // Guards the crypto independently of aws4fetch, in case the dev oracle is dropped.
  it('emits a well-formed SigV4 query', async () => {
    const url = await presignR2('GET', { ...creds, ttlSeconds: 300 })
    const p = params(url)
    expect(p['X-Amz-Algorithm']).toBe('AWS4-HMAC-SHA256')
    expect(p['X-Amz-SignedHeaders']).toBe('host')
    expect(p['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/)
    expect(p['X-Amz-Credential']).toMatch(
      new RegExp(`^${creds.accessKeyId}/\\d{8}/auto/s3/aws4_request$`),
    )
    expect(p['X-Amz-Signature']).toMatch(/^[0-9a-f]{64}$/)
  })
})
