import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

const API_PORT = Number(process.env.VITE_API_PORT || 8001)
const API_HOST = process.env.VITE_API_HOST || 'localhost'

export default defineConfig({
  plugins: [
    vue({
      script: {
        babelParserPlugins: ['jsx']
      }
    }),
    vueJsx()
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${API_HOST}:${API_PORT}`,
        changeOrigin: true,
        ws: true,
      },
      '/health': {
        target: `http://${API_HOST}:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
