import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    // 纯逻辑测试跑 node；需要 DOM 的用文件顶部 @vitest-environment jsdom 单独声明
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      '../tests/**/*.test.ts',
      '../tests/**/*.test.tsx',
    ],
  },
})
