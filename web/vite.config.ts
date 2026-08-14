import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Im lokalen Netz erreichbar, damit die App waehrend der Entwicklung
    // direkt vom Handy aufrufbar ist.
    host: '0.0.0.0',
  },
})
