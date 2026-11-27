import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],

  server: {
    proxy: {
      '/api/v1': {
        target:
          process.env.POS_API_TARGET ??
          'http://127.0.0.1:3000',

        changeOrigin: true,
      },
    },
  },
})
