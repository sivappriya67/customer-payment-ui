import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Auth endpoints bypass Gravitee (no JWT yet at login time)
      '/bankapp/auth': {
        target: 'https://localhost:3001',
        secure: false,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bankapp/, ''),
      },
      // All other routes through Gravitee — JWT validated at gateway
      '/bankapp': {
        target: 'http://localhost:8085',
        secure: false,
        changeOrigin: true,
      },
    },
  },
})
