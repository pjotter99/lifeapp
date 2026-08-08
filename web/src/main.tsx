import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Auswertung } from './Auswertung.tsx'
import { Dashboard } from './Dashboard.tsx'
import { Stammdaten } from './Stammdaten.tsx'
import { Styleguide } from './Styleguide.tsx'

// Kein Router fuer fuenf Routen — einfache Pfadweiche reicht. Vite liefert
// index.html per SPA-Fallback auch fuer diese Pfade direkt aus. "/" ist das
// Dashboard, die Ausgabenerfassung liegt bewusst auf /erfassen.
function page() {
  if (window.location.pathname === '/styleguide') return <Styleguide />
  if (window.location.pathname === '/stammdaten') return <Stammdaten />
  if (window.location.pathname === '/erfassen') return <App />
  if (window.location.pathname === '/auswertung') return <Auswertung />
  return <Dashboard />
}

createRoot(document.getElementById('root')!).render(<StrictMode>{page()}</StrictMode>)
