import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Im lokalen Netz erreichbar (z. B. vom Handy). Der Proxy-Zielpfad bleibt
    // localhost, weil Vite und Fastify auf derselben Maschine laufen — nur
    // das Handy braucht die Netzwerk-IP, nicht der Proxy selbst.
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
