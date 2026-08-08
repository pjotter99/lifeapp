import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Auswertung } from './Auswertung.tsx'
import { Dashboard } from './Dashboard.tsx'
import { DbTest } from './DbTest.tsx'
import { Einstellungen } from './Einstellungen.tsx'
import { Stammdaten } from './Stammdaten.tsx'
import { Styleguide } from './Styleguide.tsx'

// Kein Router fuer sieben Routen — einfache Pfadweiche reicht. Vite liefert
// index.html per SPA-Fallback auch fuer diese Pfade direkt aus. "/" ist das
// Dashboard, die Ausgabenerfassung liegt bewusst auf /erfassen. /stammdaten
// ist nicht mehr in der Tab-Leiste (siehe BottomTabBar.tsx), bleibt aber als
// Route bestehen und wird von /einstellungen aus verlinkt. /db-test ist
// keine echte Screen-Route, sondern die Verifikationsseite fuer Umbau-Punkt 1
// (sql.js im Browser) — nicht in der Tab-Leiste verlinkt.
function page() {
  if (window.location.pathname === '/styleguide') return <Styleguide />
  if (window.location.pathname === '/db-test') return <DbTest />
  if (window.location.pathname === '/stammdaten') return <Stammdaten />
  if (window.location.pathname === '/einstellungen') return <Einstellungen />
  if (window.location.pathname === '/erfassen') return <App />
  if (window.location.pathname === '/auswertung') return <Auswertung />
  return <Dashboard />
}

createRoot(document.getElementById('root')!).render(<StrictMode>{page()}</StrictMode>)
