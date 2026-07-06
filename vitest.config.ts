import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({})],
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.e2e.spec.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: {
              configPath: './wrangler.jsonc',
            },
          }),
        ],
        test: {
          name: 'e2e',
          include: ['src/**/*.e2e.spec.ts'],
        },
      },
    ],
  },
})
