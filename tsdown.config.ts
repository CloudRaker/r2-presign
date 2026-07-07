import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: './src/r2-presign.ts',
  format: 'esm',
  dts: true,
  clean: true,
  hash: false,
  minify: true,
  sourcemap: true,
})
