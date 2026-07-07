import { AwsClient } from 'aws4fetch'
import { describe, expect, it } from 'vitest'

import { createR2TempCredentials } from '../src/temporary-credentials'

// Parent creds resolved from env (.dev.vars via nodejs_compat).
describe('e2e: R2 temporary credentials (local signing)', () => {
  const env = process.env
  it('locally-minted creds PUT then GET against real R2', async () => {
    const creds = await createR2TempCredentials({
      scope: 'object-read-write',
      ttlSeconds: 900,
      paths: { prefixPaths: ['e2e-test/'] },
    })

    // aws4fetch sends `sessionToken` as X-Amz-Security-Token — R2 verifies the grant JWT.
    const client = new AwsClient({ ...creds, service: 's3', region: 'auto' })
    const key = `e2e-test/${Date.now()}.txt`
    const url = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`
    const body = 'temp cred round-trip'

    const putRes = await client.fetch(url, { method: 'PUT', body })
    expect(putRes.ok).toBe(true)

    const getRes = await client.fetch(url)
    expect(getRes.ok).toBe(true)
    expect(await getRes.text()).toBe(body)

    await client.fetch(url, { method: 'DELETE' })
  })

  it('read-only creds cannot write', async () => {
    const creds = await createR2TempCredentials({
      scope: 'object-read-only',
      ttlSeconds: 900,
      paths: { prefixPaths: ['e2e-test/'] },
    })
    const client = new AwsClient({ ...creds, service: 's3', region: 'auto' })
    const url = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/e2e-test/denied.txt`

    const putRes = await client.fetch(url, { method: 'PUT', body: 'nope' })
    expect(putRes.ok).toBe(false)
  })
})
