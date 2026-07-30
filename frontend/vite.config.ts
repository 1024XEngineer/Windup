import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // 全项目统一用 @/xxx 引用 src 下的模块，避免 ../../.. 相对路径
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
