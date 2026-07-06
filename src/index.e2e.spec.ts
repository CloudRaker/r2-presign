import { AwsClient } from 'aws4fetch'
import { env } from 'cloudflare:test'
import { afterAll, describe, expect, it } from 'vitest'

import { presignR2Get, presignR2Put } from './index'

const creds = {
  accountId: env.R2_ACCOUNT_ID,
  bucket: env.R2_BUCKET,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
}

describe('e2e: presign round-trip', () => {
  const key = `e2e-test/${Date.now()}.txt`
  const body = 'hello from e2e'

  afterAll(async () => {
    const client = new AwsClient({
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      service: 's3',
      region: 'auto',
    })
    const url = `https://${creds.accountId}.r2.cloudflarestorage.com/${creds.bucket}/${key}`
    await client.fetch(url, { method: 'DELETE' })
  })

  it('PUT then GET returns same content', async () => {
    const put = await presignR2Put({
      ...creds,
      key,
      contentLength: new TextEncoder().encode(body).byteLength,
      contentType: 'text/plain',
      expiresInSeconds: 300,
    })

    const putRes = await fetch(put.url, {
      method: 'PUT',
      headers: put.headers,
      body,
    })
    expect(putRes.ok).toBe(true)

    const get = await presignR2Get({ ...creds, key, expiresInSeconds: 300 })
    const getRes = await fetch(get.url)
    expect(getRes.ok).toBe(true)
    expect(await getRes.text()).toBe(body)
  })
})
