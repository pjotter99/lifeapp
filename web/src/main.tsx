import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Styleguide } from './Styleguide.tsx'

// Kein Router fuer zwei Routen — einfache Pfadweiche reicht. Vite liefert
// index.html per SPA-Fallback auch fuer /styleguide direkt aus.
const page = window.location.pathname === '/styleguide' ? <Styleguide /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)
