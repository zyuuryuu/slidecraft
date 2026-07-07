import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n' // init react-i18next (ja⇄en) before <App/> mounts
import App from './App.tsx'

// Apply the saved theme to <html> BEFORE first paint so light/modern users don't flash the dark palette.
const savedTheme = (() => { try { return localStorage.getItem('slidecraft_theme') } catch { return null } })()
document.documentElement.setAttribute('data-theme', savedTheme === 'light' || savedTheme === 'modern' ? savedTheme : 'dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
