
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Genera source maps para diagnosticar errores en producción y evitar pantallas en blanco
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true
  }
})
