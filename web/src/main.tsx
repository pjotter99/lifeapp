import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Styleguide } from './Styleguide.tsx'
import { Stammdaten } from './Stammdaten.tsx'

// Kein Router fuer vier Routen — einfache Pfadweiche reicht. Vite liefert
// index.html per SPA-Fallback auch fuer diese Pfade direkt aus. "/" faellt
// bewusst auf ExpenseEntry zurueck (App), /erfassen ist der eigentliche Pfad.
function page() {
  if (window.location.pathname === '/styleguide') return <Styleguide />
  if (window.location.pathname === '/stammdaten') return <Stammdaten />
  return <App />
}

createRoot(document.getElementById('root')!).render(<StrictMode>{page()}</StrictMode>)
