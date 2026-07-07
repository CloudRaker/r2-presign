import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const isCoverage = process.argv.includes('--coverage')

// Unit test is pure web-standard (fetch/URL/crypto) — runs in every environment.
const unit = ['test/**/*.test.ts']
const e2e = ['test/**/*.e2e.test.ts']

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: unit,
          exclude: e2e,
        },
      },
      {
        test: isCoverage // @cloudflare/vitest-pool-workers does not support V8 coverage.
          ? { include: [] }
          : {
              name: 'workers',
              include: unit,
              exclude: e2e,
              pool: cloudflarePool({
                miniflare: {
                  compatibilityDate: '2026-07-06',
                },
              }),
            },
      },
      {
        // e2e hits real R2 and imports `cloudflare:test` — needs the plugin (not just
        // the pool) to inject that virtual module. Wired to wrangler.jsonc so
        // `.dev.vars` secrets reach `env` and `process.env`.
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: isCoverage ? { include: [] } : { name: 'e2e', include: e2e },
      },
    ],
  },
})
