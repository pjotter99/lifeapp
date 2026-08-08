import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Styleguide } from './Styleguide.tsx'
import { Stammdaten } from './Stammdaten.tsx'

// Kein Router fuer drei Routen — einfache Pfadweiche reicht. Vite liefert
// index.html per SPA-Fallback auch fuer diese Pfade direkt aus.
function page() {
  if (window.location.pathname === '/styleguide') return <Styleguide />
  if (window.location.pathname === '/stammdaten') return <Stammdaten />
  return <App />
}

createRoot(document.getElementById('root')!).render(<StrictMode>{page()}</StrictMode>)
