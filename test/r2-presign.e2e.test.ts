import { AwsClient } from 'aws4fetch'
import { afterAll, describe, expect, it } from 'vitest'
import { presignR2Get, presignR2Put } from '../src/r2-presign'

describe('e2e: presign round-trip', () => {
  const key = `e2e-test/${Date.now()}.txt`
  const body = 'hello from e2e'
  const env = process.env

  afterAll(async () => {
    const client = new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    })
    const url = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`
    await client.fetch(url, { method: 'DELETE' })
  })

  // No creds passed — exercises the env fallback (process.env via nodejs_compat).
  it('PUT then GET returns same content', async () => {
    // Enforce the type: the upload must send this exact Content-Type or R2 403s.
    const put = await presignR2Put({ key, contentType: 'text/plain', expiresInSeconds: 300 })

    const putRes = await fetch(put.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body,
    })
    expect(putRes.ok).toBe(true)

    const get = await presignR2Get({ key, expiresInSeconds: 300 })
    const getRes = await fetch(get.url)
    expect(getRes.ok).toBe(true)
    expect(await getRes.text()).toBe(body)
  })
})
