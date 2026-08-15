import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Auswertung } from './Auswertung.tsx'
import { Dashboard } from './Dashboard.tsx'
import { Einstellungen } from './Einstellungen.tsx'
import { ExpenseEntry } from './ExpenseEntry.tsx'
import { IntegrityBanner } from './IntegrityBanner.tsx'
import { Nachkategorisieren } from './Nachkategorisieren.tsx'
import { currentRoute } from './routing.ts'
import { Stammdaten } from './Stammdaten.tsx'
import { Styleguide } from './Styleguide.tsx'
import { UpdateBanner } from './UpdateBanner.tsx'

// Kein Router fuer sieben Routen — einfache Pfadweiche reicht. Vite liefert
// index.html per SPA-Fallback auch fuer diese Pfade direkt aus, GitHub Pages
// per 404.html-Umleitung (siehe public/404.html). "/" ist das Dashboard, die
// Ausgabenerfassung liegt bewusst auf /erfassen. /stammdaten ist nicht mehr
// in der Tab-Leiste (siehe BottomTabBar.tsx), bleibt aber als Route bestehen
// und wird von /einstellungen aus verlinkt. currentRoute() statt direkt
// window.location.pathname, damit das unter dem GitHub-Pages-Unterpfad
// (Vite "base") genauso funktioniert wie lokal auf "/".
function page() {
  const route = currentRoute()
  if (route === '/styleguide') return <Styleguide />
  if (route === '/stammdaten') return <Stammdaten />
  if (route === '/nachkategorisieren') return <Nachkategorisieren />
  if (route === '/einstellungen') return <Einstellungen />
  if (route === '/erfassen') return <ExpenseEntry />
  if (route === '/auswertung') return <Auswertung />
  return <Dashboard />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UpdateBanner />
    <IntegrityBanner />
    {page()}
  </StrictMode>,
)
