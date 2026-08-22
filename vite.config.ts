import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'vendor'
          }
          if (id.includes('@radix-ui')) {
            return 'ui'
          }
          if (id.includes('recharts')) {
            return 'charts'
          }
          if (id.includes('@supabase')) {
            return 'supabase'
          }
        },
      },
    },
  },
})
