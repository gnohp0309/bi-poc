import { defineConfig } from 'vite'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
// The pinned OpenUI package exposes only a barrel, which loads the demo's entire icon registry.
const intelligentUiDist = dirname(require.resolve('@openuidev/intelligent-ui-library')).replace(/\\/g, '/')

export default defineConfig({
  resolve: {
    alias: [{ find: /^@openuidev\/intelligent-ui-library\/dist\//, replacement: intelligentUiDist + '/' }],
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8081' }
  }
})
